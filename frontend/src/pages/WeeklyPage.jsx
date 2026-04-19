import { useState, useEffect, useRef, useCallback } from 'react'
import { FolderOpen } from 'lucide-react'
import { useBackgroundSync } from '../lib/utils'
import { useAdmin } from '../lib/useAdmin'

// ── DropboxPreviewModal ───────────────────────────────────────────────────────
function DropboxPreviewModal({ task, weekEnding, memberName, onClose, onItemAdded }) {
  const hasDropbox = !!task.dropbox_link
  const hasFio = !!task.frameio_link
  const [view, setView] = useState(task._fioMode || !hasDropbox ? 'frameio' : 'dropbox')

  // ── Dropbox state
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(new Set())
  const [lightbox, setLightbox] = useState(null)

  // ── Frame.io state
  const [fioAssets, setFioAssets] = useState([])
  const [fioLoading, setFioLoading] = useState(false)
  const [fioError, setFioError] = useState('')

  useEffect(() => {
    if (!hasDropbox) return
    setLoading(true); setError('')
    fetch('/api/dropbox/folder?url=' + encodeURIComponent(task.dropbox_link))
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setFiles(d.files || []) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [task.dropbox_link])

  useEffect(() => {
    if (!hasFio || fioAssets.length > 0) return
    setFioLoading(true); setFioError('')
    fetch('/api/frameio/assets?reviewUrl=' + encodeURIComponent(task.frameio_link))
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setFioAssets(d.assets || []) })
      .catch(e => setFioError(String(e)))
      .finally(() => setFioLoading(false))
  }, [task.frameio_link, view])

  const [fioSelected, setFioSelected] = useState(new Set())
  const [fioCopying, setFioCopying] = useState(false)
  const [fioCopied, setFioCopied] = useState(new Set())
  const [fioLightbox, setFioLightbox] = useState(null)  // asset | null for viewing
  const [fioVideoUrl, setFioVideoUrl] = useState(null)  // resolved inline URL

  const toggleFioSelect = (id) => setFioSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  const openFioLightbox = async (asset) => {
    setFioLightbox(asset); setFioVideoUrl(null)
    try {
      const r = await fetch(`/api/frameio/media-url?fileId=${asset.file_id}`)
      const d = await r.json()
      setFioVideoUrl(d.inlineUrl || d.downloadUrl || null)
    } catch (_) {}
  }

  const addFioToWeekly = async () => {
    if (fioCopying || fioSelected.size === 0) return
    setFioCopying(true)
    const toAdd = fioAssets.filter(a => fioSelected.has(a.id))
    const newCopied = new Set(fioCopied)
    for (const asset of toAdd) {
      try {
        const res = await fetch('/api/frameio/to-dropbox', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId: asset.file_id, fileName: asset.name, weekEnding, memberName }),
        })
        const data = await res.json()
        if (!data.success) throw new Error(data.error)
        newCopied.add(asset.id)
      } catch (e) { alert(`Failed to copy ${asset.name}: ${e}`) }
    }
    setFioCopied(newCopied); setFioSelected(new Set()); setFioCopying(false)
    if (newCopied.size > fioCopied.size) onItemAdded?.(task.id)
  }

  const mediaFiles = files.filter(f => f.is_image || f.is_video)
  const lbIdx = lightbox ? mediaFiles.findIndex(f => f.name === lightbox.name) : -1

  const toggleSelect = (name) => setSelected(prev => {
    const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next
  })

  const addToWeekly = async () => {
    if (copying || selected.size === 0) return
    setCopying(true)
    const toAdd = files.filter(f => selected.has(f.name))
    const newlyCopied = new Set(copied)
    for (const file of toAdd) {
      try {
        const res = await fetch('/api/dropbox/copy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: file.path_lower ?? null,
            sharedUrl: file.path_lower ? null : task.dropbox_link,
            fileName: file.name, weekEnding, memberName,
          }),
        })
        const data = await res.json()
        if (!data.success) throw new Error(data.error)
        newlyCopied.add(file.name)
      } catch (e) { alert(`Failed to copy ${file.name}: ${e}`) }
    }
    setCopied(newlyCopied); setSelected(new Set()); setCopying(false)
    if (newlyCopied.size > copied.size) onItemAdded?.(task.id)
  }

  const thumbUrl = f =>
    f.path_lower
      ? `/api/dropbox/thumbnail?path=${encodeURIComponent(f.path_lower)}`
      : `/api/dropbox/thumbnail?url=${encodeURIComponent(task.dropbox_link)}&path=${encodeURIComponent(f.name)}`
  const playUrl = f =>
    f.path_lower
      ? `/api/dropbox/thumbnail?path=${encodeURIComponent(f.path_lower)}&mode=play`
      : `/api/dropbox/thumbnail?url=${encodeURIComponent(task.dropbox_link)}&path=${encodeURIComponent(f.name)}&mode=play`

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-[#1a1a2e] border border-white/10 w-full max-w-2xl max-h-[85vh] rounded-t-2xl sm:rounded-2xl flex flex-col shadow-2xl">
        <div className="flex items-start justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="min-w-0 flex-1 pr-4">
            {/* Tab toggle — only when both links exist */}
            {hasDropbox && hasFio ? (
              <div className="flex gap-1 mb-2">
                <button onClick={() => setView('dropbox')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    view === 'dropbox' ? 'bg-[#0061FE]/20 text-[#0061FE]' : 'text-muted-foreground hover:text-foreground'
                  }`}>📁 Dropbox</button>
                <button onClick={() => setView('frameio')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    view === 'frameio' ? 'bg-orange-500/20 text-orange-400' : 'text-muted-foreground hover:text-foreground'
                  }`}>▶ Frame.io</button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mb-0.5">{view === 'frameio' ? 'Frame.io' : 'Dropbox Files'}</p>
            )}
            <h2 className="text-sm font-semibold text-white leading-snug truncate">{task.name}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none p-1">✕</button>
        </div>
        {/* ── DROPBOX VIEW ── */}
        {view === 'dropbox' && (
          <>
            <div className="flex-1 overflow-y-auto p-5">
              {loading && (
                <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                  <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <span className="text-sm">Loading files...</span>
                </div>
              )}
              {!loading && error && <p className="text-sm text-red-400 py-4">{error}</p>}
              {!loading && !error && files.length === 0 && <p className="text-sm text-muted-foreground py-4">No files found.</p>}
              {!loading && !error && files.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {files.map(file => {
                    const isMedia = file.is_image || file.is_video
                    const isSelected = selected.has(file.name)
                    const isCopied = copied.has(file.name)
                    if (isMedia) return (
                      <div key={file.name} className="relative group aspect-square rounded-lg overflow-hidden border border-white/10 bg-white/5">
                        <button className="absolute inset-0 w-full h-full focus:outline-none" onClick={() => setLightbox(file)}>
                          <img src={thumbUrl(file)} alt={file.name} className="w-full h-full object-cover" />
                          {file.is_video && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center">
                                <span className="text-white text-sm pl-0.5">▶</span>
                              </div>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end pointer-events-none">
                            <p className="w-full text-white text-xs px-2 py-1 bg-black/50 translate-y-full group-hover:translate-y-0 transition-transform truncate">{file.name}</p>
                          </div>
                        </button>
                        {!isCopied && (
                          <button onClick={e => { e.stopPropagation(); toggleSelect(file.name) }}
                            className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-primary border-primary' : 'bg-white/80 border-white/80 opacity-0 group-hover:opacity-100'}`}>
                            {isSelected && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                          </button>
                        )}
                        {isCopied && (
                          <div className="absolute inset-0 bg-green-600/70 flex flex-col items-center justify-center gap-1 pointer-events-none">
                            <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            <span className="text-white text-xs font-medium">Added</span>
                          </div>
                        )}
                      </div>
                    )
                    return (
                      <div key={file.name} className="rounded-lg border border-white/10 bg-white/5 aspect-square flex flex-col items-center justify-center gap-2 p-3">
                        <span className="text-2xl">📄</span>
                        <p className="text-xs text-muted-foreground text-center line-clamp-2 break-all">{file.name}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            {!loading && !error && mediaFiles.length > 0 && (
              <div className="border-t border-white/10 px-5 py-3 flex items-center justify-between shrink-0">
                <p className="text-xs text-muted-foreground">
                  {selected.size > 0 ? `${selected.size} selected` : 'Select files to add to Weekly'}
                </p>
                <button onClick={addToWeekly} disabled={selected.size === 0 || copying}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40 transition-colors hover:bg-primary/80">
                  {copying && <div className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                  Add to Weekly
                </button>
              </div>
            )}
          </>
        )}

        {/* ── FRAME.IO VIEW ── */}
        {view === 'frameio' && (
          <div className="flex-1 overflow-y-auto p-5">
            {fioLoading && (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <div className="h-5 w-5 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" />
                <span className="text-sm">Loading Frame.io assets...</span>
              </div>
            )}
            {!fioLoading && fioError && (
              <div className="py-4 space-y-2">
                <p className="text-sm text-red-400">{fioError}</p>
                <a href={task.frameio_link} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-orange-400 hover:text-orange-300">
                  Open review link directly →
                </a>
              </div>
            )}
            {!fioLoading && !fioError && fioAssets.length === 0 && (
              <div className="py-4 space-y-2">
                <p className="text-sm text-muted-foreground">No video assets found in this Frame.io link.</p>
                <a href={task.frameio_link} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-orange-400 hover:text-orange-300">
                  Open review link directly →
                </a>
              </div>
            )}
            {!fioLoading && !fioError && fioAssets.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {fioAssets.map(asset => {
                  const isSelected = fioSelected.has(asset.id)
                  const isCopied = fioCopied.has(asset.id)
                  const dur = asset.duration ? `${Math.floor(asset.duration / 60)}:${String(Math.floor(asset.duration % 60)).padStart(2, '0')}` : null
                  return (
                    <div key={asset.id} className="relative group aspect-square rounded-lg overflow-hidden border border-orange-500/20 bg-white/5">
                      {/* Thumbnail — click to open lightbox */}
                      <button className="absolute inset-0 w-full h-full focus:outline-none" onClick={() => openFioLightbox(asset)}>
                        {asset.thumb
                          ? <img src={asset.thumb} alt={asset.name} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-4xl">🎬</div>
                        }
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center group-hover:bg-orange-500/80 transition-colors">
                            <span className="text-white text-sm pl-0.5">▶</span>
                          </div>
                        </div>
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-end pointer-events-none">
                          <div className="w-full px-2 py-1.5 bg-black/60 translate-y-full group-hover:translate-y-0 transition-transform">
                            <p className="text-white text-xs truncate">{asset.name}</p>
                            {dur && <p className="text-orange-300 text-[10px]">{dur}</p>}
                          </div>
                        </div>
                      </button>
                      {/* Checkbox */}
                      {!isCopied && (
                        <button onClick={e => { e.stopPropagation(); toggleFioSelect(asset.id) }}
                          className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            isSelected ? 'bg-orange-500 border-orange-500' : 'bg-white/80 border-white/80 opacity-0 group-hover:opacity-100'
                          }`}>
                          {isSelected && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        </button>
                      )}
                      {/* Copied overlay */}
                      {isCopied && (
                        <div className="absolute inset-0 bg-green-600/70 flex flex-col items-center justify-center gap-1 pointer-events-none">
                          <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          <span className="text-white text-xs font-medium">Added</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {/* Footer for Frame.io batch copy */}
        {view === 'frameio' && !fioLoading && !fioError && fioAssets.length > 0 && (
          <div className="border-t border-white/10 px-5 py-3 flex items-center justify-between shrink-0">
            <p className="text-xs text-muted-foreground">
              {fioSelected.size > 0 ? `${fioSelected.size} selected` : 'Select videos to add to Weekly'}
            </p>
            <button onClick={addFioToWeekly} disabled={fioSelected.size === 0 || fioCopying}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-medium disabled:opacity-40 transition-colors hover:bg-orange-400">
              {fioCopying && <div className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />}
              Add to Weekly
            </button>
          </div>
        )}

      </div>
      {/* ── Frame.io video lightbox ── */}
      {fioLightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95"
          onClick={e => { if (e.target === e.currentTarget) setFioLightbox(null) }}>
          <button onClick={() => setFioLightbox(null)} className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl z-10">✕</button>
          <div className="max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3 w-full px-4">
            {fioVideoUrl
              ? <video src={fioVideoUrl} controls autoPlay className="max-w-full max-h-[75vh] rounded-xl shadow-2xl bg-black" />
              : <div className="w-64 h-40 flex items-center justify-center gap-2 text-muted-foreground">
                  <div className="h-5 w-5 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" />
                  <span className="text-sm">Loading...</span>
                </div>
            }
            <div className="flex items-center gap-3">
              <p className="text-white/70 text-sm truncate max-w-xs">{fioLightbox.name}</p>
              <a href={fioLightbox.view_url || task.frameio_link} target="_blank" rel="noopener noreferrer"
                className="text-orange-400 hover:text-orange-300 text-xs shrink-0">Open in Frame.io ↗</a>
            </div>
          </div>
        </div>
      )}
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90"
          onClick={e => { if (e.target === e.currentTarget) setLightbox(null) }}>
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl">✕</button>
          {lbIdx > 0 && <button onClick={() => setLightbox(mediaFiles[lbIdx - 1])} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl p-2">‹</button>}
          {lbIdx < mediaFiles.length - 1 && <button onClick={() => setLightbox(mediaFiles[lbIdx + 1])} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl p-2">›</button>}
          <div className="max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3">
            {lightbox.is_image
              ? <img src={playUrl(lightbox)} alt={lightbox.name} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
              : <video src={playUrl(lightbox)} controls autoPlay className="max-w-full max-h-[80vh] rounded-lg" />}
            <p className="text-white/70 text-sm">{lightbox.name}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── WorkSampleUpload ──────────────────────────────────────────────────────────
function WorkSampleUpload({ memberName, weekEnding }) {
  const [uploads, setUploads] = useState([])
  const [dragging, setDragging] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlTitle, setUrlTitle] = useState('')
  const [urlSaving, setUrlSaving] = useState(false)
  const fileInputRef = useRef(null)

  const uploadFile = async (file) => {
    setUploads(prev => [...prev, { name: file.name, status: 'uploading' }])
    try {
      const linkRes = await fetch('/api/dropbox/upload-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, memberName, weekEnding }),
      })
      const linkData = await linkRes.json()
      if (!linkData.success) throw new Error(linkData.error || 'Failed to get upload link')
      const uploadRes = await fetch(linkData.link, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      })
      if (!uploadRes.ok) throw new Error('Upload failed')
      setUploads(prev => prev.map(u => u.name === file.name ? { ...u, status: 'success' } : u))
    } catch (err) {
      setUploads(prev => prev.map(u => u.name === file.name ? { ...u, status: 'error', error: String(err) } : u))
    }
  }

  const handleFiles = (files) => { if (!files) return; Array.from(files).forEach(uploadFile) }

  const saveUrl = async () => {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    setUrlSaving(true)
    const name = `${(urlTitle.trim() || trimmed).slice(0, 60)}.url`
    setUploads(prev => [...prev, { name, status: 'uploading' }])
    try {
      const res = await fetch('/api/dropbox/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, title: urlTitle.trim() || trimmed, memberName, weekEnding }),
      })
      const data = await res.json()
      setUploads(prev => prev.map(u => u.name === name ? { ...u, status: data.success ? 'success' : 'error', error: data.error } : u))
      if (data.success) { setUrlInput(''); setUrlTitle('') }
    } catch (err) {
      setUploads(prev => prev.map(u => u.name === name ? { ...u, status: 'error', error: String(err) } : u))
    } finally { setUrlSaving(false) }
  }

  return (
    <div className="p-6 space-y-5">
      <h3 className="text-base font-semibold text-foreground">Upload Work Samples</h3>
      <div
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${dragging ? 'border-primary bg-primary/5' : 'border-border/40 hover:border-primary/50'}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}>
        <p className="text-2xl mb-2">📁</p>
        <p className="text-sm text-muted-foreground mb-3">Drop files here or</p>
        <button onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 rounded-lg border border-border/50 text-sm text-foreground hover:bg-white/5 transition-colors">
          Browse Files
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">🔗 Save URL as shortcut</p>
        <input type="text" placeholder="https://..." value={urlInput} onChange={e => setUrlInput(e.target.value)}
          className="w-full px-3 py-1.5 rounded-lg border border-border/40 bg-background/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
        <div className="flex gap-2">
          <input type="text" placeholder="Title (optional)" value={urlTitle} onChange={e => setUrlTitle(e.target.value)}
            className="flex-1 px-3 py-1.5 rounded-lg border border-border/40 bg-background/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
          <button onClick={saveUrl} disabled={!urlInput.trim() || urlSaving}
            className="px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium disabled:opacity-40 transition-colors">
            {urlSaving ? '…' : 'Save'}
          </button>
        </div>
      </div>
      {uploads.length > 0 && (
        <div className="space-y-1.5">
          {uploads.map((u, i) => (
            <div key={i} className="flex items-center gap-2">
              {u.status === 'uploading' && <span className="text-primary text-xs animate-spin inline-block">⟳</span>}
              {u.status === 'success' && <span className="text-green-400 text-xs">✓</span>}
              {u.status === 'error' && <span className="text-red-400 text-xs">✕</span>}
              <span className="flex-1 truncate text-xs text-foreground">{u.name}</span>
              {u.status === 'error' && <span className="text-red-400 text-xs truncate max-w-[160px]">{u.error}</span>}
              {u.status === 'success' && <span className="text-green-400 text-xs shrink-0">Uploaded ✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── WeeklyFilesPreview ────────────────────────────────────────────────────────
function WeeklyFilesPreview({ memberName, weekEnding }) {
  const [files, setFiles] = useState([])
  const [folder, setFolder] = useState('')
  const [sharedLink, setSharedLink] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [deleting, setDeleting] = useState(new Set())
  const [showUpload, setShowUpload] = useState(false)

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/dropbox/weekly-files?weekEnding=${encodeURIComponent(weekEnding)}&memberName=${encodeURIComponent(memberName)}`)
      const d = await r.json()
      setFiles(d.files ?? [])
      setFolder(d.folder ?? '')
      setSharedLink(d.sharedLink ?? null)
    } catch { setFiles([]) }
    finally { setLoading(false) }
  }, [memberName, weekEnding])

  useEffect(() => { fetchFiles() }, [fetchFiles])

  const thumbUrl = (f) => `/api/dropbox/thumbnail?path=${encodeURIComponent(f.path_lower)}`
  const playUrl = (f) => `/api/dropbox/thumbnail?path=${encodeURIComponent(f.path_lower)}&mode=play`

  const deleteFile = async (file) => {
    setDeleting(prev => new Set(prev).add(file.path_lower))
    try {
      await fetch('/api/dropbox/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path_lower }),
      })
      setFiles(prev => prev.filter(f => f.path_lower !== file.path_lower))
    } finally {
      setDeleting(prev => { const s = new Set(prev); s.delete(file.path_lower); return s })
    }
  }

  const media = files.filter(f => f.is_image || f.is_video)
  const lbIdx = lightbox ? media.findIndex(f => f.path_lower === lightbox.path_lower) : -1

  return (
    <>
      <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-foreground">Selected Files</span>
            {folder && <p className="text-[10px] text-muted-foreground mt-0.5">{folder}/{memberName}</p>}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowUpload(true)}
              className="flex items-center gap-1 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 px-2 py-1 rounded transition-colors">
              + Upload
            </button>
            {files.length > 0 && (
              <button onClick={() => setEditMode(e => !e)}
                className={`text-xs transition-colors ${editMode ? 'text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
                {editMode ? '✓ Done' : '✎ Edit'}
              </button>
            )}
            <button onClick={fetchFiles} disabled={loading}
              className="text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">⟳</button>
          </div>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="flex gap-3">
              {[1,2,3,4].map(i => <div key={i} className="shrink-0 w-28 h-28 rounded-lg bg-white/5 animate-pulse" />)}
            </div>
          ) : files.length === 0 ? (
            <p className="text-sm text-muted-foreground/60 py-1">No files added yet for this week.</p>
          ) : (
            <div className={"flex gap-3 overflow-x-auto pb-1 " + (editMode ? 'pt-3 pl-2' : '')}>
              {files.map(file => (
                <div key={file.path_lower} className="relative shrink-0 w-[160px] h-[160px]">
                  <button onClick={() => !editMode && setLightbox(file)}
                    className="relative w-full h-full rounded-lg overflow-hidden border border-border/30 bg-white/5 group">
                    <img src={thumbUrl(file)} alt={file.name} className="w-full h-full object-cover" />
                    {file.is_video && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-7 h-7 rounded-full bg-black/50 flex items-center justify-center">
                          <span className="text-white text-[10px]">▶</span>
                        </div>
                      </div>
                    )}
                    {!editMode && (
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end pointer-events-none">
                        <p className="w-full text-white text-[10px] px-1.5 py-1 bg-black/50 translate-y-full group-hover:translate-y-0 transition-transform truncate">{file.name}</p>
                      </div>
                    )}
                  </button>
                  {editMode && (
                    <button onClick={() => deleteFile(file)} disabled={deleting.has(file.path_lower)}
                      className="absolute -top-2 -left-2 z-10 w-6 h-6 rounded-full bg-red-500 border-2 border-white flex items-center justify-center shadow-md hover:bg-red-600 transition-colors disabled:opacity-50">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) { setShowUpload(false); fetchFiles() } }}>
          <div className="relative w-full max-w-md rounded-xl shadow-2xl bg-card border border-border/40">
            <button onClick={() => { setShowUpload(false); fetchFiles() }}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground text-lg z-10">✕</button>
            <WorkSampleUpload memberName={memberName} weekEnding={weekEnding} />
          </div>
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90"
          onClick={e => { if (e.target === e.currentTarget) setLightbox(null) }}>
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl">✕</button>
          {lbIdx > 0 && <button onClick={() => setLightbox(media[lbIdx-1])} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-3xl p-2">‹</button>}
          {lbIdx < media.length - 1 && <button onClick={() => setLightbox(media[lbIdx+1])} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-3xl p-2">›</button>}
          <div className="max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3">
            {lightbox.is_image
              ? <img src={playUrl(lightbox)} alt={lightbox.name} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
              : <video src={playUrl(lightbox)} controls autoPlay className="max-w-full max-h-[80vh] rounded-lg" />}
            <p className="text-white/70 text-sm">{lightbox.name}</p>
          </div>
        </div>
      )}
    </>
  )
}

// ── AllFilesOverlay ───────────────────────────────────────────────────────────
// Read-only view of every member's weekly Dropbox files stacked together
function AllFilesOverlay({ members, weekEnding, onClose }) {
  const [allFiles, setAllFiles] = useState({})   // { memberId: { files, folder, loading } }
  const [lightbox, setLightbox] = useState(null) // { file, memberName }

  useEffect(() => {
    const init = {}
    members.forEach(m => { init[m.id] = { files: [], folder: '', loading: true } })
    setAllFiles(init)
    members.forEach(async (m) => {
      try {
        const r = await fetch(`/api/dropbox/weekly-files?weekEnding=${encodeURIComponent(weekEnding)}&memberName=${encodeURIComponent(m.name)}`)
        const d = await r.json()
        setAllFiles(prev => ({ ...prev, [m.id]: { files: d.files ?? [], folder: d.folder ?? '', loading: false } }))
      } catch {
        setAllFiles(prev => ({ ...prev, [m.id]: { files: [], folder: '', loading: false } }))
      }
    })
  }, [members, weekEnding])

  const thumbUrl = f => `/api/dropbox/thumbnail?path=${encodeURIComponent(f.path_lower)}`
  const playUrl  = f => `/api/dropbox/thumbnail?path=${encodeURIComponent(f.path_lower)}&mode=play`

  const allMedia = members.flatMap(m =>
    (allFiles[m.id]?.files ?? []).filter(f => f.is_image || f.is_video).map(f => ({ file: f, memberName: m.name }))
  )
  const lbIdx = lightbox ? allMedia.findIndex(x => x.file.path_lower === lightbox.file.path_lower) : -1

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 shrink-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">All Selected Files</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Week ending {weekEnding}</p>
        </div>
        <button onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-xl border border-border/40 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground text-lg transition-colors">
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {members.map(m => {
          const { files, folder, loading } = allFiles[m.id] ?? { files: [], folder: '', loading: true }
          return (
            <div key={m.id} className="rounded-xl border border-border/40 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30 flex items-center gap-3">
                <span className="text-sm font-semibold text-foreground">{m.name}</span>
                {folder && <span className="text-[10px] text-muted-foreground">{folder}/{m.name}</span>}
                {!loading && <span className="text-[10px] text-muted-foreground ml-auto">{files.length} file{files.length !== 1 ? 's' : ''}</span>}
              </div>
              <div className="p-4">
                {loading ? (
                  <div className="flex gap-3">
                    {[1,2,3,4].map(i => <div key={i} className="shrink-0 w-[160px] h-[160px] rounded-lg bg-white/5 animate-pulse" />)}
                  </div>
                ) : files.length === 0 ? (
                  <p className="text-sm text-muted-foreground/60 py-1">No files added yet for this week.</p>
                ) : (
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {files.map(file => (
                      <button key={file.path_lower}
                        onClick={() => setLightbox({ file, memberName: m.name })}
                        className="relative shrink-0 w-[160px] h-[160px] rounded-lg overflow-hidden border border-border/30 bg-white/5 group">
                        <img src={thumbUrl(file)} alt={file.name} className="w-full h-full object-cover" />
                        {file.is_video && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-7 h-7 rounded-full bg-black/50 flex items-center justify-center">
                              <span className="text-white text-[10px]">▶</span>
                            </div>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end pointer-events-none">
                          <p className="w-full text-white text-[10px] px-1.5 py-1 bg-black/50 translate-y-full group-hover:translate-y-0 transition-transform truncate">{file.name}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90"
          onClick={e => { if (e.target === e.currentTarget) setLightbox(null) }}>
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl">✕</button>
          {lbIdx > 0 && <button onClick={() => setLightbox(allMedia[lbIdx-1])} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl p-2">‹</button>}
          {lbIdx < allMedia.length - 1 && <button onClick={() => setLightbox(allMedia[lbIdx+1])} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl p-2">›</button>}
          <div className="max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3">
            {lightbox.file.is_image
              ? <img src={playUrl(lightbox.file)} alt={lightbox.file.name} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
              : <video src={playUrl(lightbox.file)} controls autoPlay className="max-w-full max-h-[80vh] rounded-lg" />}
            <div className="flex flex-col items-center gap-0.5">
              <p className="text-white/70 text-sm">{lightbox.file.name}</p>
              <p className="text-white/40 text-xs">{lightbox.memberName}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── WeeklyColumn ──────────────────────────────────────────────────────────────
function WeeklyColumn({ title, tasks, loaded, loading, onTaskClick, onRefresh, fioConnected, addedTaskIds }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {onRefresh && (
          <button onClick={onRefresh} disabled={loading}
            title="Refresh tasks from Monday.com"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
            <svg className={"w-3 h-3 " + (loading ? 'animate-spin' : '')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        )}
      </div>
      <div className="flex-1 p-4">
        {loading && !loaded ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 rounded bg-white/5 animate-pulse" />)}</div>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground/60">No tasks for this period.</p>
        ) : (
          <div className="space-y-2">
            {tasks.map(task => (
              <div key={task.id} onClick={() => onTaskClick && onTaskClick(task)}
                className={"flex items-start gap-3 p-2.5 rounded-lg bg-white/[0.03] border border-border/20 transition-colors " + (onTaskClick && (task.dropbox_link || task.frameio_link) ? 'cursor-pointer hover:bg-white/[0.08] hover:border-primary/30' : 'hover:bg-white/[0.06]')}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm text-foreground font-medium leading-snug">{task.name}</p>
                    {addedTaskIds?.has(String(task.id)) && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/25 shrink-0">
                        ✓ Added
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {task.status && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                        style={task.status_color ? { backgroundColor: task.status_color + '22', color: task.status_color, border: '1px solid ' + task.status_color + '55' } : { background: 'rgba(255,255,255,0.08)', color: '#9090a0' }}>
                        {task.status}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{task.board_name}</span>
                    {task.timeline_end && <span className="text-xs text-muted-foreground">Due {task.timeline_end}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 mt-0.5">
                  {task.dropbox_link && (
                    <a href={task.dropbox_link} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      title="Open Dropbox folder"
                      className="text-[#0061FE] hover:text-blue-400 transition-colors">
                      <FolderOpen size={14} />
                    </a>
                  )}
                  {task.monday_url && (
                    <a href={task.monday_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                      title="Open in Monday.com"
                      className="text-muted-foreground hover:opacity-80 transition-opacity shrink-0">
                      <svg width="20" height="8" viewBox="0 0 30 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="5"  cy="6" r="5" fill="#FF3D57"/>
                        <circle cx="15" cy="6" r="5" fill="#FFBC00"/>
                        <circle cx="25" cy="6" r="5" fill="#00CA72"/>
                      </svg>
                    </a>
                  )}
                  {task.frameio_link && (
                    fioConnected ? (
                      <button onClick={e => { e.stopPropagation(); setSelectedTask({ ...task, _fioMode: true }) }}
                        title="Browse Frame.io files" className="text-orange-400 hover:text-orange-300 transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                        </svg>
                      </button>
                    ) : (
                      <a href={task.frameio_link} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()} title="Open in Frame.io"
                        className="text-orange-400 hover:text-orange-300 transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                        </svg>
                      </a>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── FrameioConnectModal ────────────────────────────────────────────────────────
function FrameioConnectModal({ onClose, onConnected, initialError, initialCode }) {
  const [step, setStep] = useState(initialCode ? 'opened' : 'idle')
  const [code, setCode] = useState(initialCode || '')
  const [error, setError] = useState(initialError || '')

  const openAuth = async () => {
    const r = await fetch('/api/frameio/auth-url')
    const { url } = await r.json()
    window.open(url, '_blank')
    setStep('opened')
  }

  const exchange = async () => {
    if (!code.trim()) return
    setStep('exchanging'); setError('')
    try {
      const r = await fetch('/api/frameio/exchange-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() })
      })
      const data = await r.json()
      if (!r.ok) { setError(data.error || 'Exchange failed'); setStep('opened'); return }
      setStep('done')
      setTimeout(onConnected, 800)
    } catch (e) { setError(e.message); setStep('opened') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border/50 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Connect Frame.io</h2>
            <p className="text-xs text-muted-foreground mt-0.5">One-time setup — you won't need to do this again</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">✕</button>
        </div>

        {step === 'done' ? (
          <div className="text-center py-4 text-green-400 font-medium">✓ Connected!</div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground">Step 1 — Authorize with Adobe</p>
              <button onClick={openAuth}
                className="w-full py-2.5 rounded-xl bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 text-sm font-medium transition-colors">
                Open Adobe Login →
              </button>
            </div>
            {step === 'opened' && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">Step 2 — Copy the <span className="text-orange-400">code</span> from the URL bar</p>
                <p className="text-xs text-muted-foreground">After logging in, you'll be redirected to <code className="text-orange-300">{window.location.host}</code> — copy the <code className="text-orange-300">?code=...</code> value from the URL bar</p>
                <input value={code} onChange={e => setCode(e.target.value)} placeholder="Paste code here..."
                  className="w-full bg-white/5 border border-border/40 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-orange-500/50" />
                <button onClick={exchange} disabled={!code.trim() || step === 'exchanging'}
                  className="w-full py-2 rounded-xl bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium disabled:opacity-40 transition-colors">
                  {step === 'exchanging' ? 'Connecting...' : 'Complete Setup'}
                </button>
                {error && <p className="text-xs text-red-400">{error}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── WeeklyPage ────────────────────────────────────────────────────────────────
export default function WeeklyPage() {
  const [members, setMembers] = useState([])
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('weeklyActiveTab') || null)
  const [tasksByMember, setTasksByMember] = useState({})
  const [loading, setLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date(); const sun = new Date(now)
    sun.setDate(now.getDate() - now.getDay()); sun.setHours(0,0,0,0); return sun
  })
  const [selectedTask, setSelectedTask] = useState(null)
  const [fioConnected, setFioConnected] = useState(null) // null=loading, false=not connected, true=connected
  const [showFioConnect, setShowFioConnect] = useState(false)
  const [showAllFiles, setShowAllFiles] = useState(false)

  const [fioAutoCode, setFioAutoCode] = useState('')
  const [fioAutoError, setFioAutoError] = useState('')

  useEffect(() => {
    // Auto-detect Frame.io OAuth callback (?code= in URL)
    const params = new URLSearchParams(window.location.search)
    const oauthCode = params.get('code')
    if (oauthCode) {
      window.history.replaceState({}, '', window.location.pathname)
      setFioAutoCode(oauthCode)
      setShowFioConnect(true)
      fetch('/api/frameio/exchange-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: oauthCode })
      }).then(r => r.json()).then(d => {
        if (d.ok) { setFioConnected(true); setShowFioConnect(false) }
        else setFioAutoError(d.error || 'Token exchange failed')
      }).catch(e => setFioAutoError(e.message))
    }
    fetch('/api/frameio/status').then(r => r.json()).then(d => setFioConnected(d.connected)).catch(() => setFioConnected(false))
  }, [])

  function getWeekDates(sunday) {
    const lastSun = new Date(sunday); lastSun.setDate(sunday.getDate() - 7)
    const lastSat = new Date(lastSun); lastSat.setDate(lastSun.getDate() + 6)
    const thisSat = new Date(sunday); thisSat.setDate(sunday.getDate() + 6)
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    return { weekStart: fmt(lastSun), weekEnd: fmt(lastSat), nextWeekStart: fmt(sunday), nextWeekEnd: fmt(thisSat) }
  }

  const { isAdmin } = useAdmin()
  const dates = getWeekDates(selectedDate)

  // Track which task IDs have had items added to weekly — persisted per week in localStorage
  // Key is scoped to the currently-viewed week so next week starts fresh
  const addedKey = `weeklyAdded:${dates.nextWeekEnd}`
  const [addedTaskIds, setAddedTaskIds] = useState(() => {
    try {
      const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      const now = new Date(); const sun = new Date(now); sun.setDate(now.getDate() - now.getDay())
      const sat = new Date(sun); sat.setDate(sun.getDate() + 6)
      return new Set(JSON.parse(localStorage.getItem(`weeklyAdded:${fmt(sat)}`) || '[]'))
    } catch { return new Set() }
  })
  const markTaskAdded = useCallback((taskId) => {
    setAddedTaskIds(prev => {
      const next = new Set(prev)
      next.add(String(taskId))
      try { localStorage.setItem(addedKey, JSON.stringify([...next])) } catch {}
      return next
    })
  }, [addedKey])

  const fetchTasks = (force = false) => {
    const validMembers = (members || []).filter(m => m.monday_user_id)
    if (validMembers.length === 0) return
    if (force) setLoading(true)
    const { weekStart, weekEnd, nextWeekStart, nextWeekEnd } = dates
    fetch('/api/monday/team-tasks?week_start=' + weekStart + '&week_end=' + weekEnd + '&next_week_start=' + nextWeekStart + '&next_week_end=' + nextWeekEnd + (force ? '&force=true' : ''))
      .then(r => r.json())
      .then(data => {
        const fromCache = data._meta?.fromCache === true
        const mapped = {}
        for (const m of validMembers)
          mapped[m.id] = { lastWeek: (data[m.monday_user_id] || {}).lastWeek || [], thisWeek: (data[m.monday_user_id] || {}).thisWeek || [], loaded: true }
        setTasksByMember(mapped)
        if (fromCache) setTimeout(() => fetchTasks(true), 1500)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetch('/api/monday/settings').then(r => r.json()).then(d => {
      const mems = d.members || []
      setMembers(mems)
      if (mems.length > 0) {
        const saved = localStorage.getItem('weeklyActiveTab')
        const valid = saved && mems.find(m => m.id === saved)
        setActiveTab(valid ? saved : mems[0].id)
      }
    }).catch(console.error)
  }, [])

  useEffect(() => { fetchTasks() }, [members.length, dates.weekStart])
  useBackgroundSync(() => fetchTasks())

  const activeMember = members.find(m => m.id === activeTab)
  const memberData = activeMember ? (tasksByMember[activeMember.id] || { lastWeek: [], thisWeek: [], loaded: false }) : null

  const isCurrentWeek = (() => {
    const now = new Date(); const day = now.getDay()
    const thisSun = new Date(now); thisSun.setDate(now.getDate() - day); thisSun.setHours(0,0,0,0)
    return selectedDate.getTime() === thisSun.getTime()
  })()
  const goToPrevWeek = () => { const d = new Date(selectedDate); d.setDate(d.getDate() - 7); setSelectedDate(d); setTasksByMember({}) }
  const goToNextWeek = () => { const d = new Date(selectedDate); d.setDate(d.getDate() + 7); setSelectedDate(d); setTasksByMember({}) }
  const goToThisWeek = () => { const now = new Date(); const day = now.getDay(); const sun = new Date(now); sun.setDate(now.getDate() - day); sun.setHours(0,0,0,0); setSelectedDate(sun); setTasksByMember({}) }
  const fmtLabel = (s) => { const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  const fmtLabelYear = (s) => { const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }

  return (
    <div className="space-y-6">
      {/* Frame.io connection banner */}
      {fioConnected === false && (
        <div className="flex items-center justify-between gap-3 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-orange-400 text-sm font-medium">Frame.io not connected</span>
            <span className="text-xs text-muted-foreground">— connect to browse and copy videos to Dropbox</span>
          </div>
          <button onClick={() => setShowFioConnect(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 font-medium transition-colors">
            Connect Frame.io
          </button>
        </div>
      )}
      {showFioConnect && <FrameioConnectModal onClose={() => setShowFioConnect(false)} onConnected={() => { setFioConnected(true); setShowFioConnect(false) }} initialError={fioAutoError} initialCode={fioAutoCode} />}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">Weekly Report</h1>
          {fioConnected && (
            <button onClick={() => setShowFioConnect(true)} title="Frame.io connected"
              className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 font-medium hover:bg-orange-500/25 transition-colors">
              ⬡ Frame.io
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 bg-white/5 border border-border/30 rounded-xl px-4 py-2.5">
          <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span className="text-xs text-muted-foreground font-medium">Week:</span>
          <div className="flex items-center gap-2">
            <button onClick={goToPrevWeek}
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-border/40 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
            </button>
            <span className="text-sm font-semibold text-foreground min-w-[180px] text-center">
              {fmtLabel(dates.nextWeekStart)} &ndash; {fmtLabelYear(dates.nextWeekEnd)}
            </span>
            <button onClick={goToNextWeek}
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-border/40 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
          {!isCurrentWeek && (
            <button onClick={goToThisWeek}
              className="text-xs text-primary hover:text-primary/80 font-medium px-2 py-1 rounded-lg hover:bg-primary/10 transition-colors">
              This Week
            </button>
          )}
        </div>
        <button onClick={() => setShowAllFiles(true)}
          className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors font-semibold tracking-wide border-0">
          View All Files
        </button>
      </div>
      {members.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <p className="text-4xl">&#128202;</p>
          <p className="text-lg font-semibold text-foreground">Monday settings not configured</p>
          <p className="text-sm text-muted-foreground">Add board IDs and member IDs to load tasks.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-1 border-b border-border/40 overflow-x-auto">
            {members.map(m => (
              <button key={m.id} onClick={() => { setActiveTab(m.id); localStorage.setItem('weeklyActiveTab', m.id) }}
                className={"px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors " + (activeTab === m.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                {m.name}
              </button>
            ))}
          </div>
          {activeMember && memberData && (
            <div className="space-y-6">
              <WeeklyFilesPreview memberName={activeMember.name} weekEnding={dates.nextWeekEnd} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <WeeklyColumn title="Last Week" tasks={memberData.lastWeek} loaded={memberData.loaded} loading={loading}
                  onTaskClick={task => (task.dropbox_link || task.frameio_link) && setSelectedTask(task)}
                  onRefresh={() => { setLoading(true); fetchTasks(true) }} fioConnected={fioConnected}
                  addedTaskIds={isAdmin ? addedTaskIds : null} />
                <WeeklyColumn title="This Week" tasks={memberData.thisWeek} loaded={memberData.loaded} loading={loading}
                  onRefresh={() => { setLoading(true); fetchTasks(true) }} fioConnected={fioConnected}
                  addedTaskIds={isAdmin ? addedTaskIds : null} />
              </div>
            </div>
          )}
        </>
      )}
      {selectedTask && <DropboxPreviewModal task={selectedTask} weekEnding={dates.nextWeekEnd} memberName={activeMember?.name ?? ''} onClose={() => setSelectedTask(null)} onItemAdded={markTaskAdded} />}
      {showAllFiles && <AllFilesOverlay members={members} weekEnding={dates.nextWeekEnd} onClose={() => setShowAllFiles(false)} />}
    </div>
  )
}
