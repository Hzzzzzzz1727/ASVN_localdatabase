import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const vercelConfigPath = path.join(repoRoot, 'vercel.json')

const isWindows = process.platform === 'win32'

function log(message) {
  process.stdout.write(`${message}\n`)
}

function spawnLogged(command, args, options = {}) {
  if (isWindows) {
    const child = spawn(command, args, {
      ...options,
      shell: true,
    })
    return child
  }

  return spawn(command, args, {
    ...options,
    shell: false,
  })
}

function pipeOutput(child, prefix) {
  const writePrefixed = (chunk, stream) => {
    const text = chunk.toString()
    const lines = text.split(/\r?\n/)
    for (const line of lines) {
      if (!line) continue
      stream.write(`[${prefix}] ${line}\n`)
    }
  }

  child.stdout?.on('data', (chunk) => writePrefixed(chunk, process.stdout))
  child.stderr?.on('data', (chunk) => writePrefixed(chunk, process.stderr))
}

function resolveCloudflaredPath() {
  if (process.env.CLOUDFLARED_PATH) {
    return process.env.CLOUDFLARED_PATH
  }

  const guesses = [
    path.join(process.env.USERPROFILE || '', 'Downloads', 'cloudflared.exe'),
    path.join('C:\\', 'cloudflared', 'cloudflared.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'cloudflared', 'cloudflared.exe'),
    'cloudflared',
    'cloudflared.exe',
  ]

  return guesses.find((candidate) => {
    if (candidate === 'cloudflared' || candidate === 'cloudflared.exe') return true
    return requirePathExists(candidate)
  }) || 'cloudflared'
}

function requirePathExists(targetPath) {
  try {
    if (targetPath === 'cloudflared' || targetPath === 'cloudflared.exe') {
      return true
    }
    return !!targetPath && existsSync(targetPath)
  } catch {
    return false
  }
}

async function updateVercelJson(baseUrl) {
  const raw = await fs.readFile(vercelConfigPath, 'utf8')
  const config = JSON.parse(raw)
  const rewrites = Array.isArray(config.rewrites) ? config.rewrites : []
  let changed = false

  for (const rewrite of rewrites) {
    if (rewrite?.source === '/api/:match*') {
      const next = `${baseUrl}/api/:match*`
      if (rewrite.destination !== next) {
        rewrite.destination = next
        changed = true
      }
    }

    if (rewrite?.source === '/media/(.*)') {
      const next = `${baseUrl}/media/$1`
      if (rewrite.destination !== next) {
        rewrite.destination = next
        changed = true
      }
    }
  }

  if (changed) {
    await fs.writeFile(vercelConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  }

  return changed
}

function runGit(args) {
  return new Promise((resolve, reject) => {
    const child = spawnLogged('git', args, {
      cwd: repoRoot,
      stdio: 'inherit',
    })

    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`git ${args.join(' ')} exited with code ${code}`))
    })
  })
}

async function autoPushVercelJson(url) {
  const commitMessage = `Update tunnel URL to ${new URL(url).hostname}`
  await runGit(['add', 'vercel.json'])
  await runGit(['commit', '-m', commitMessage])
  await runGit(['push', 'origin', 'main'])
  log(`[setup] Da push tunnel moi len GitHub. Cho Vercel build lai roi mo web.`)
}

async function main() {
  const enableAutoPush = process.argv.includes('--git-push')

  log('[setup] Dang mo local API...')
  const apiProcess = spawnLogged('npm', ['run', 'local-api'], {
    cwd: repoRoot,
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  pipeOutput(apiProcess, 'local-api')

  const cloudflaredPath = resolveCloudflaredPath()
  log(`[setup] Dang mo cloudflared bang: ${cloudflaredPath}`)

  const tunnelProcess = spawnLogged(cloudflaredPath, ['tunnel', '--url', 'http://127.0.0.1:3030'], {
    cwd: repoRoot,
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  pipeOutput(tunnelProcess, 'cloudflared')

  let handledUrl = false

  const handleTunnelOutput = async (chunk) => {
    if (handledUrl) return
    const text = chunk.toString()
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu)
    if (!match) return

    handledUrl = true
    const baseUrl = match[0]
    log(`[setup] Tim thay tunnel moi: ${baseUrl}`)

    try {
      const changed = await updateVercelJson(baseUrl)
      if (changed) {
        log('[setup] Da cap nhat vercel.json voi URL tunnel moi.')
        if (enableAutoPush) {
          await autoPushVercelJson(baseUrl)
        } else {
          log('[setup] Neu muon Vercel dung URL moi, chay:')
          log('        git add vercel.json')
          log(`        git commit -m "Update tunnel URL to ${new URL(baseUrl).hostname}"`)
          log('        git push origin main')
        }
      } else {
        log('[setup] vercel.json da dung URL tunnel hien tai.')
      }

      log('[setup] Giu cua so nay mo. Nhan Ctrl+C de dung ca local API va tunnel.')
    } catch (error) {
      console.error('[setup] Khong cap nhat duoc vercel.json:', error)
    }
  }

  tunnelProcess.stdout?.on('data', handleTunnelOutput)
  tunnelProcess.stderr?.on('data', handleTunnelOutput)

  const shutdown = (signal) => {
    log(`\n[setup] Nhan ${signal}. Dang dung local API va cloudflared...`)
    apiProcess.kill()
    tunnelProcess.kill()
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  apiProcess.on('exit', (code) => {
    if (code !== 0) {
      log(`[setup] local-api da dung voi ma ${code}.`)
    }
  })

  tunnelProcess.on('exit', (code) => {
    if (code !== 0) {
      log(`[setup] cloudflared da dung voi ma ${code}.`)
    }
  })
}

await main()
