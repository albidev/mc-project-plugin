import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { CodeBinaryViewer, isBinaryPreviewable } from '../components/CodeBinaryViewer'

function installDom(): Window {
  const window = new Window({ url: 'http://localhost/mc-project-plugin' })
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    DOMException: window.DOMException,
    MutationObserver: window.MutationObserver,
    ResizeObserver: window.ResizeObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
  })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return window
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function envelope(data: unknown) {
  return new Response(
    JSON.stringify({
      ok: true,
      data,
      meta: { schemaVersion: 1, requestId: 'test-request', observedAt: '2026-09-18T10:00:00+00:00' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function errorResponse(status: number, code: string) {
  return new Response(JSON.stringify({ error: code }), { status })
}

async function render(props: { projectId: string; path?: string }) {
  const window = installDom()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(CodeBinaryViewer, props))
    await wait(50)
  })
  return { window, host, root }
}

test('#36 image blob renders an img from the object URL', async () => {
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  const originalCreate = URL.createObjectURL.bind(URL)
  const originalRevoke = URL.revokeObjectURL.bind(URL)
  try {
    URL.createObjectURL = (blob: Blob) => {
      urls.push(blob.type)
      return 'blob:mock-img'
    }
    URL.revokeObjectURL = () => {}
    globalThis.fetch = async () =>
      envelope({
        path: 'img.png',
        contentType: 'image/png',
        size: 4,
        contentBase64: Buffer.from('test', 'utf8').toString('base64'),
        truncated: false,
      })
    const { host, root } = await render({ projectId: 'demo', path: 'img.png' })
    try {
      await wait(100)
      const img = host.querySelector<HTMLImageElement>('[data-testid="code-binary-viewer"]')
      assert.ok(img)
      assert.equal(img.tagName, 'IMG')
      assert.equal(img.src, 'blob:mock-img')
      assert.equal(urls[0], 'image/png')
    } finally {
      await act(async () => root.unmount())
    }
  } finally {
    globalThis.fetch = originalFetch
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})

test('#36 pdf blob renders an embed plus fallback link', async () => {
  const originalFetch = globalThis.fetch
  try {
    const pdfBase64 = Buffer.from('%PDF-1.4', 'utf8').toString('base64')
    globalThis.fetch = async () =>
      envelope({ path: 'doc.pdf', contentType: 'application/pdf', size: 8, contentBase64: pdfBase64, truncated: false })
    const { host, root } = await render({ projectId: 'demo', path: 'doc.pdf' })
    try {
      await wait(100)
      const embed = host.querySelector<HTMLElement>('[data-testid="code-binary-viewer"][type="application/pdf"]')
      assert.ok(embed)
      assert.ok(host.querySelector('a[target="_blank"]'))
    } finally {
      await act(async () => root.unmount())
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('#36 unsupported extension shows state without calling fileRaw', async () => {
  const originalFetch = globalThis.fetch
  let fetchCalled = false
  try {
    globalThis.fetch = async () => {
      fetchCalled = true
      return envelope({})
    }
    const { host, root } = await render({ projectId: 'demo', path: 'notes.txt' })
    try {
      await wait(50)
      assert.ok(host.querySelector('[data-testid="code-binary-unsupported"]'))
      assert.equal(fetchCalled, false)
    } finally {
      await act(async () => root.unmount())
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('#36 413 and 404 and generic errors map to explicit messages', async () => {
  const originalFetch = globalThis.fetch
  const cases: Array<{ status: number; code: string; expected: string }> = [
    { status: 413, code: 'PAYLOAD_TOO_LARGE', expected: /File exceeds preview size limit/ },
    { status: 404, code: 'NOT_FOUND', expected: /File not found/ },
    { status: 500, code: 'SERVICE_UNAVAILABLE', expected: /Unable to load preview/ },
  ]
  try {
    for (const item of cases) {
      globalThis.fetch = async () => errorResponse(item.status, item.code)
      const { host, root } = await render({ projectId: 'demo', path: 'big.png' })
      try {
        await wait(50)
        assert.match(host.textContent ?? '', item.expected)
      } finally {
        await act(async () => root.unmount())
      }
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('#36 isBinaryPreviewable covers the contract extensions', () => {
  for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf']) {
    assert.equal(isBinaryPreviewable(`file.${extension}`), true, extension)
    assert.equal(isBinaryPreviewable(`file.${extension.toUpperCase()}`), true, `${extension} uppercase`)
  }
  assert.equal(isBinaryPreviewable('notes.txt'), false)
  assert.equal(isBinaryPreviewable(undefined), false)
})
