import { spawnSync } from 'child_process'

export type SecretStoreKind = 'plaintext' | 'windows-dpapi'

export function preferredSecretStore(): SecretStoreKind {
  return process.platform === 'win32' ? 'windows-dpapi' : 'plaintext'
}

export function encryptForStore(secret: string, kind: SecretStoreKind): { kind: SecretStoreKind; value: string } {
  const s = (secret ?? '').toString()
  if (!s) return { kind: 'plaintext', value: '' }
  if (kind !== 'windows-dpapi') return { kind: 'plaintext', value: s }
  const value = windowsDpapiEncrypt(s)
  return { kind: 'windows-dpapi', value }
}

export function decryptFromStore(value: string, kind: SecretStoreKind): string {
  const v = (value ?? '').toString()
  if (!v) return ''
  if (kind !== 'windows-dpapi') return v
  return windowsDpapiDecrypt(v)
}

function windowsDpapiEncrypt(plain: string): string {
  const ps = [
    '$p=[Console]::In.ReadToEnd()',
    '$s=ConvertTo-SecureString -String $p -AsPlainText -Force',
    '$enc=$s | ConvertFrom-SecureString',
    '[Console]::Out.Write($enc)',
  ].join('; ')
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    input: plain,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (r.status !== 0) {
    const msg = (r.stderr ?? '').toString().trim() || 'DPAPI encrypt failed.'
    throw new Error(msg)
  }
  return (r.stdout ?? '').toString().trim()
}

function windowsDpapiDecrypt(enc: string): string {
  const ps = [
    '$e=[Console]::In.ReadToEnd()',
    '$s=ConvertTo-SecureString $e',
    '$p=[System.Net.NetworkCredential]::new(\'\', $s).Password',
    '[Console]::Out.Write($p)',
  ].join('; ')
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    input: enc,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (r.status !== 0) {
    const msg = (r.stderr ?? '').toString().trim() || 'DPAPI decrypt failed.'
    throw new Error(msg)
  }
  return (r.stdout ?? '').toString()
}

