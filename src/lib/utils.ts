// 通用小工具
export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function yuan(n: number): string {
  return `${n.toFixed(2)} 元`
}

export function vol(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `${n} m³`
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 把照片压到长边 1600、JPEG 0.72 的 dataURL 后再存 IndexedDB，
 * 避免大照片把本机存储撑爆。纯本地处理，不上传。
 */
export function fileToCompressedDataUrl(file: File): Promise<{ dataUrl: string; type: string; name: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('图片读取失败'))
      img.onload = () => {
        const MAX = 1600
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve({ dataUrl: String(reader.result), type: file.type, name: file.name })
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
        resolve({ dataUrl, type: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '') + '.jpg' })
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
