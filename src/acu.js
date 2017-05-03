import fs from 'fs'
import path from 'path'
import ora from 'ora'
import chalk from 'chalk'
import program from 'commander'
import inquirer from 'inquirer'
import request from 'request'
import Progress from 'progress'
import { execFile, spawn } from 'child_process'

const pkg = require(path.join(__dirname, '../package.json'))
const isTTY = process.stderr.isTTY && !process.env.CI

program
  .option('-b, --beta', 'Check for beta releases')
  .option('-y, --force-yes', 'Install without user confirmation')
  .parse(process.argv)

const RELEASES_API = 'https://api.github.com/repos/atom/atom/releases'
const DOWNLOAD_URL = 'https://github.com/atom/atom/releases/download'
const RELEASE_URL = 'https://github.com/atom/atom/releases/tag'
const USER_AGENT = `atom-check-updates/${pkg.version}`
const TEMP_FOLDER = '/tmp/acu'
const DISTRO_DEBIAN = Symbol('deb')
const DISTRO_RPM = Symbol('rpm')

const distroConfig = {
  [DISTRO_DEBIAN]: {
    name: 'Debian',
    file: 'atom-amd64.deb',
    cmd: ['dpkg', '-i'],
  },
  [DISTRO_RPM]: {
    name: 'RPM',
    file: 'atom.x86_64.rpm',
    cmd: ['rpm', '-Uvh'],
  },
}

const bin = program.beta ? 'atom-beta' : 'atom'

const getDebianConfig = () =>
  new Promise((resolve, reject) =>
    execFile(
      '/usr/bin/dpkg',
      ['-S', '/usr/bin/dpkg'],
      err => (err ? reject(err) : resolve(distroConfig[DISTRO_DEBIAN]))
    )
  )

const getRPMConfig = () =>
  new Promise((resolve, reject) =>
    execFile(
      '/usr/bin/rpm',
      ['-q', '-f', '/usr/bin/rpm'],
      err => (err ? reject(err) : resolve(distroConfig[DISTRO_RPM]))
    )
  )

const getDistroConfig = async () => {
  try {
    return await getDebianConfig()
  } catch (e) {}

  try {
    return await getRPMConfig()
  } catch (e) {}

  return false
}

const getCurrentVersion = () =>
  new Promise((resolve, reject) => {
    execFile(bin, ['--version'], (err, stdout, stderr) => {
      if (err || stderr) {
        resolve(null)
      } else {
        const version = stdout.match(
          /^Atom\s+?:\s+(\d+\.\d+\.\d+(?:-\w+\d+)?)$/im
        )

        resolve(version[1])
      }
    })
  })

const getLatestVersion = () =>
  new Promise((resolve, reject) =>
    request(
      {
        url: RELEASES_API,
        headers: { 'User-Agent': USER_AGENT },
        json: true,
      },
      (err, res, body) => {
        if (err) {
          reject(err)
        } else {
          const release = body.find(
            release => release.prerelease === !!program.beta
          )

          resolve(release.name)
        }
      }
    )
  )

const getChangelog = version =>
  new Promise((resolve, reject) =>
    request(
      {
        url: 'https://git.io',
        method: 'post',
        form: { url: `${RELEASE_URL}/v${version}` },
        headers: { 'User-Agent': USER_AGENT },
      },
      (err, res) => (err ? reject(err) : resolve(res.headers['location']))
    )
  )

const download = (version, distro) =>
  new Promise((resolve, reject) => {
    const { green, dim } = chalk
    const { file } = distro

    const opts = {
      url: `${DOWNLOAD_URL}/v${version}/${file}`,
      headers: { 'User-Agent': USER_AGENT },
    }

    try {
      fs.accessSync(TEMP_FOLDER, fs.W_OK)
    } catch (err) {
      if (err.code === 'ENOENT') {
        fs.mkdirSync(TEMP_FOLDER)
      } else {
        throw err
      }
    }

    const dest = path.join(TEMP_FOLDER, `${version}-${file}`)
    const req = request(opts)

    req.on('response', res => {
      if (isTTY) {
        const len = parseInt(res.headers['content-length'], 10)
        const tmpl = `  ${file} [${green(':bar')}] :percent ${dim(':etas')}`
        const bar = new Progress(tmpl, {
          complete: '=',
          incomplete: ' ',
          width: 40,
          total: len,
        })

        res.on('data', chunk => bar.tick(chunk.length))
      }

      res.on('end', () => resolve(dest))
    })

    req.on('error', err => reject(err))

    req.pipe(fs.createWriteStream(dest))
  })

const install = (file, distro) =>
  new Promise((resolve, reject) => {
    const { cmd } = distro

    const dpkg = spawn('sudo', [...cmd, file], {
      stdio: ['ignore', 'inherit', 'inherit'],
    })

    dpkg.on('error', err => reject(err))
    dpkg.on('exit', res => resolve(res))
  })

const acu = async () => {
  const { bold, underline, dim } = chalk
  const releaseType = program.beta ? 'beta' : 'stable'
  const spinner = ora()

  spinner.info(`atom-check-updates v${pkg.version}`)

  spinner.text = 'Checking distro'
  spinner.start()

  try {
    const distro = await getDistroConfig()

    if (!distro) {
      spinner.fail(`You don't seem to be running a supported distro`)

      process.exit(1)
    }

    spinner.succeed(`Detected as running on a ${bold(distro.name)}-based distro.`)

    spinner.text = `Checking for installed ${bold(releaseType)} version.`
    spinner.start()

    const current = await getCurrentVersion()

    spinner.succeed(
      `Installed ${bold(releaseType)} version: ` +
        (current ? bold(current) : 'None, or older than 1.7.0')
    )

    spinner.text = `Checking for latest ${bold(releaseType)} release.`
    spinner.start()

    const latest = await getLatestVersion()
    const changelog = await getChangelog(latest)

    if (current === latest) {
      spinner.succeed(
        `You're already on the latest ${bold(releaseType)} version! ` +
          `(changelog: ${underline(changelog)})`
      )

      process.exit(0)
    } else {
      spinner.info(
        `Latest ${bold(releaseType)} version: ${bold(latest)} ` +
          `(changelog: ${underline(changelog)})`
      )
    }

    if (!program.forceYes) {
      if (isTTY) {
        const answer = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `${current ? 'Upgrade to' : 'Install'} v${latest}?`,
            default: false,
          },
        ])

        if (!answer.confirm) {
          spinner.fail('Installation aborted.')

          process.exit(1)
        }
      } else {
        spinner.fail(`Not in a TTY. Pass ${dim('--force-yes')} to continue.`)

        process.exit(1)
      }
    }

    const file = await download(latest, distro)
    const result = await install(file, distro)

    if (result === 0) {
      spinner.succeed('Installation completed successfully.')

      fs.unlinkSync(file)

      process.exit(0)
    }
  } catch (err) {
    spinner.fail('An unexpected error occured.')
    process.stderr.write(err.toString())

    process.exit(1)
  }
}

export default acu
