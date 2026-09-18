import React, { useEffect, useState } from 'react'
import { ApiError, projectsApi } from '../api'

const BINARY_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

export function isBinaryPreviewable(path: string | undefined): boolean {
  if (!path) return false
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return BINARY_EXTENSIONS.has(extension)
}

function extension(path: string | undefined): string | undefined {
  if (!path) return undefined
  return path.split('.').pop()?.toLowerCase()
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'PAYLOAD_TOO_LARGE' || error.status === 413) return 'File exceeds preview size limit.'
    if (error.code === 'NOT_FOUND' || error.status === 404) return 'File not found.'
  }
  return 'Unable to load preview.'
}

export function CodeBinaryViewer({
  projectId,
  path,
}: {
  projectId: string
  path?: string
}) {
  const ext = extension(path)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'unsupported'>('idle')
  const [url, setUrl] = useState<string | undefined>()
  const [type, setType] = useState<string | undefined>()
  const [message, setMessage] = useState<string | undefined>()

  useEffect(() => {
    let objectUrl: string | undefined
    let cancelled = false
    if (!path || !isBinaryPreviewable(path)) {
      setState('unsupported')
      setUrl(undefined)
      setMessage(undefined)
      return () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
      }
    }
    setState('loading')
    setMessage(undefined)
    projectsApi
      .fileRaw(projectId, path)
      .then((blob) => {
        if (cancelled) return
        setType(blob.type)
        if (blob.type.startsWith('image/') || blob.type === 'application/pdf') {
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
          setState('ready')
        } else {
          setState('unsupported')
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setState('error')
        setMessage(messageFor(cause))
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, path])

  if (state === 'loading') {
    return (
      <div className="bg-surface text-text-muted flex h-full min-h-0 items-center justify-center p-4 font-mono text-xs" role="status">
        Loading preview…
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div data-testid="code-binary-external-error" className="bg-surface text-text-muted p-4 font-mono text-xs" role="status">
        {message}
      </div>
    )
  }

  if (state === 'unsupported' || !url || !type) {
    return (
      <div data-testid="code-binary-unsupported" className="bg-surface text-text-muted p-4 font-mono text-xs" role="status">
        No preview available for this file type.
      </div>
    )
  }

  if (type === 'application/pdf') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <embed data-testid="code-binary-viewer" type="application/pdf" src={url} className="min-h-0 flex-1" />
        <a href={url} target="_blank" rel="noreferrer" className="px-2 py-1 text-xs underline">
          Open in new tab
        </a>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-auto p-2">
      <img data-testid="code-binary-viewer" src={url} alt={path ?? ''} className="max-h-full max-w-full object-contain" />
    </div>
  )
}
