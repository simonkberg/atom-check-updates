import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import program from 'commander'
import inquirer from 'inquirer'
import request from 'request'
import Progress from 'progress'
import {execFile, execFileSync, spawn} from 'child_process'

const pkg = require(path.join(__dirname, '../package.json'))

program
  .option('-b, --beta', 'Check for beta releases')
  .option('-y, --force-yes', 'Update without user confirmation')
  .parse(process.argv)

const RELEASES_API = 'https://api.github.com/repos/atom/atom/releases'
const DOWNLOAD_URL = 'https://github.com/atom/atom/releases/download'
const RELEASE_URL = 'https://github.com/atom/atom/releases/tag'
const USER_AGENT = `atom-check-updates/${pkg.version}`
const DISTRO_DEBIAN = Symbol('deb')
const DISTRO_RPM = Symbol('rpm')

const distro = {
  [DISTRO_DEBIAN]: {
    name: 'Debian',
    file: 'atom-amd64.deb',
    cmd: ['dpkg', '-i']
  },
  [DISTRO_RPM]: {
    name: 'RPM',
    file: 'atom.x86_64.rpm',
    cmd: ['rpm', '-Uvh']
  }
}

const bin = program.beta ? 'atom-beta' : 'atom'
const log = console.log.bind(console)

const format = {
  intro: chalk.bgMagenta.bold,
  headline: chalk.green.bold.underline,
  info: chalk.dim.italic,
  text: chalk.white.bold,
  good: chalk.green.bold,
  bad: chalk.red.bold,
  success: chalk.bgGreen.bold,
  error: chalk.bgRed.bold,
  warning: chalk.bgYellow.bold
}

async function detectDistro () {
  return await new Promise((resolve, reject) => {
    // TODO: something less ugly?
    try {
      execFileSync('/usr/bin/dpkg', ['-S', '/usr/bin/dpkg'])

      return resolve(distro[DISTRO_DEBIAN])
    } catch (err) {
      try {
        execFileSync('/usr/bin/rpm', ['-q', '-f', '/usr/bin/rpm'])

        return resolve(distro[DISTRO_RPM])
      } catch (err) {
        return resolve(false)
      }
    }
  })
}

async function getCurrentVersion () {
  return await new Promise((resolve, reject) => {
    execFile(bin, ['--version'], (error, stdout, stderr) => {
      if (error || stderr) return resolve(null)

      const version = stdout.match(/^Atom\s+:\s+(\d\.\d\.\d(?:-\w+\d+)?)$/m)

      resolve(version[1])
    })
  })
}

async function getLatestVersion () {
  return await new Promise((resolve, reject) => {
    const opts = {
      url: RELEASES_API,
      headers: { 'User-Agent': USER_AGENT },
      json: true
    }

    request(opts, (err, res, body) => {
      if (err) return reject(err)

      const release = body.find((release) => {
        return release.prerelease === !!program.beta
      })

      resolve(release.name)
    })
  })
}

async function getChangelog (version) {
  return await new Promise((resolve, reject) => {
    const opts = {
      url: 'https://git.io',
      method: 'post',
      form: { url: `${RELEASE_URL}/v${version}` },
      headers: { 'User-Agent': USER_AGENT }
    }

    request(opts, (err, res, body) => {
      if (err) return reject(err)

      resolve(res.headers['location'])
    })
  })
}

async function download (version, distro) {
  const { good, info } = format

  return await new Promise((resolve, reject) => {
    const { file } = distro

    const opts = {
      url: `${DOWNLOAD_URL}/v${version}/${file}`,
      headers: { 'User-Agent': USER_AGENT }
    }

    const tmp = fs.mkdtempSync('/tmp/acu-')
    const dest = path.join(tmp, `${version}-${file}`)
    const req = request(opts)

    req.on('response', (res) => {
      const len = parseInt(res.headers['content-length'], 10)
      const tmpl = ` - ${file} [:bar] :percent ${info(':etas')}`
      const bar = new Progress(tmpl, {
        complete: good('='),
        incomplete: ' ',
        width: 40,
        total: len
      })

      res.on('data', (chunk) => bar.tick(chunk.length))
      res.on('end', () => resolve(dest))
    })

    req.on('error', (err) => reject(err))

    req.pipe(fs.createWriteStream(dest))
  })
}

async function install (file, distro) {
  return await new Promise((resolve, reject) => {
    const { cmd } = distro

    const dpkg = spawn('sudo', [...cmd, file], {
      stdio: ['ignore', 'inherit', 'inherit']
    })

    dpkg.on('error', (err) => reject(err))
    dpkg.on('exit', (res) => resolve(res))
  })
}

module.exports = async function init () {
  const releaseType = program.beta ? 'beta' : 'stable'
  const { intro, info, headline, text, success, warning, error } = format

  log(intro('  ✨ atom-check-updates v%s ✨  '), pkg.version, '\n')

  log(info('Retrieving information about your distro...'))

  const distro = await detectDistro()

  if (!distro) {
    log(error('You don\'t seem to be running a supported distro'))

    process.exit(1)
  }

  log(text('- Detected as running on a %s-based distro.'), distro.name, '\n')

  log(`${info('Checking for installed')} ${info.bold(releaseType)} ${info('version...')}`)

  const current = await getCurrentVersion()

  log(headline('Current version:'))
  log(text('  - %s'), current || 'None, or older than 1.7.0', '\n')

  log(`${info('Checking for latest')} ${info.bold(releaseType)} ${info('release...')}`)

  const latest = await getLatestVersion()
  const changelog = await getChangelog(latest)

  log(headline('Latest version:'))
  log(text('  - %s'), latest, `(changelog: ${changelog})\n`)

  if (current === latest) {
    log(success('You\'re already on the latest version!'))

    process.exit(0)
  }

  log(warning('An update is available!'))

  if (!program.forceYes) {
    const answer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Upgrade to v${latest}?`,
        default: false
      }
    ])

    if (!answer.confirm) {
      log(error('Installation aborted!'))

      process.exit(1)
    }
  }

  log(headline('Downloading:'))

  try {
    const file = await download(latest, distro)
    const result = await install(file, distro)

    if (result === 0) {
      log(success('Installation completed successfully!'))

      fs.unlinkSync(file)

      process.exit(0)
    }
  } catch (err) {
    throw err
  }

  log(error('An unknown error occured'))

  process.exit(1)
}
