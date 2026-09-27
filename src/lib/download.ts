/** Save a Blob as a local file (browser download). Nothing leaves the device. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // Revoke after the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
