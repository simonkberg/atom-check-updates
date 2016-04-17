# atom-check-updates

[![Travis][build-badge]][build] [![npm package][npm-badge]][npm]

A CLI for easily updating [Atom][atom] to the latest version
on RPM or Debian-based systems.

```sh
npm install --global atom-check-updates
```

Inspired by [atom-updater][atom-updater], which sadly doesn't work with atom
versions past 1.7.x

## how to use
```sh
$ acu -h # or atom-check-updates

  Usage: acu [options]

  Options:

    -h, --help       output usage information
    -b, --beta       Check for beta releases
    -y, --force-yes  Update without user confirmation

# check for latest stable release (prompt for update)
$ acu
# check for latest beta release (prompt for update)
$ acu --beta
# update to latest beta, if a new version is available,
# without asking for confirmation
$ acu --beta --force-yes
```
## license
[MIT][license] © 2016 Simon Kjellberg


[atom-updater]: https://github.com/mehcode/atom-updater
[atom]: https://atom.io
[license]: ./LICENSE
[npm-badge]: https://img.shields.io/npm/v/atom-check-updates.svg?style=flat-square
[npm]: https://www.npmjs.org/package/atom-check-updates
