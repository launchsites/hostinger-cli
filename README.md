# Hostinger CLI

A cross-platform CLI to manage Hostinger hosted websites. It uses Hostinger's public API to list domains and SFTP for file operations on shared hosting.

## Features
- List all domains available in your Hostinger account.
- Connect to a domain and manage files via an interactive shell.
- Upload, download, replace, and update site files through SFTP.

## Requirements
- Node.js 18+ (recommended: latest LTS)
- A Hostinger API token
- SFTP/SSH access enabled on your hosting plan

## Install Node.js
Choose one of the following:

### macOS
- Install Node.js LTS from: https://nodejs.org/en/download
- Or use Homebrew:
  ```sh
  brew install node
  ```

### Windows
- Install Node.js LTS from: https://nodejs.org/en/download

### Linux
- Use your distro package manager, or install from NodeSource:
  ```sh
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```

Verify:
```sh
node -v
npm -v
```

## Install This CLI

### Local dev install
From the repo root:
```sh
npm install
npm run build
npm link
```
Now you can run `hostinger` anywhere.

### Alternative: local project usage
```sh
npm install
npm run build
node dist/index.js
```

## Setup

### 1) Create an API token
In hPanel: Account Settings → API → generate a token.

### 2) Save the token
```sh
hostinger token set <TOKEN>
```

The token is stored in:
- macOS/Linux: `~/.config/hostinger/config.json`
- Windows: `%APPDATA%/hostinger/config.json`

### 3) Get SFTP credentials
In hPanel: Hosting → Manage → SSH Access (or FTP Accounts)
- Host: FTP IP from SSH Access
- Port: `65002`
- User: FTP/SSH username
- Password: FTP/SSH password

## Usage

Start the interactive shell:
```sh
hostinger
```

Shell commands:
```
help                         Show help
domains                      List domains via Hostinger API
connect <domain>             Set active domain
disconnect                   Clear active domain
pwd                          Show current remote directory
root <absolutePath|auto>     Set remote root and cwd
cd <path>                    Change remote directory
ls [path]                    List remote directory
mkdir <path>                 Create remote directory
rm [-r] <path>               Remove file or directory
put <local> [remote]         Upload file to remote
get <remote> [local]         Download file or directory
replace <local> [remote]     Replace remote dir contents
update <local> [remote]      Add/update files, keep extras
open [remote]                Download to temp and open
exit                         Quit shell
```

## Common Flow
```
hostinger
connect example.com
root auto
ls
cd public_html
replace ./dist
```

## Notes
- `root auto` tries to find `/home/<username>/domains/<domain>/public_html`.
- If your hosting uses a different root, set it explicitly:
  ```
  root /home/<username>/domains/<domain>/public_html
  ```
- `open` downloads to a temp folder then opens the file/folder using the OS default app.

## Security
- API tokens and SFTP credentials are stored outside the repo in a local config file.
- Do not commit any config files or credentials.

## License
TBD
