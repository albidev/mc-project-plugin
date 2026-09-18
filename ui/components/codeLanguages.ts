import type { Extension } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { xml } from '@codemirror/lang-xml'

const LANGUAGES: Record<string, Extension> = {
  ts: javascript(),
  tsx: javascript(),
  js: javascript(),
  jsx: javascript(),
  py: python(),
  json: json(),
  md: markdown(),
  markdown: markdown(),
  yaml: yaml(),
  yml: yaml(),
  css: css(),
  html: html(),
  htm: html(),
  xml: xml(),
}

/** Language extension for a file path, or plain text when unknown. */
export function languageForPath(path: string | undefined): Extension {
  if (!path) return []
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return LANGUAGES[extension] ?? []
}
