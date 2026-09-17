import { readFile } from 'node:fs/promises'
import ts from 'typescript'

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.tsx')) {
      for (const extension of ['.ts', '.tsx']) {
        try {
          return await nextResolve(`${specifier}${extension}`, context)
        } catch {}
      }
    }
    throw error
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true }
  if (url.endsWith('.tsx')) {
    const source = await readFile(new URL(url), 'utf8')
    return {
      format: 'module',
      source: ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
      shortCircuit: true,
    }
  }
  return nextLoad(url, context)
}
