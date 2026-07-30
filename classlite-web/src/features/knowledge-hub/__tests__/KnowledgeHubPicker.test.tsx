// Story 4.4b (AC6, TEST-FE-1/5) — the reusable "From Knowledge Hub" picker and
// its mode contract: allowedTypes filtering (non-allowed files disabled),
// single vs multi selection, the per-seam empty state, and confirm returning the
// selected file(s). axe.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { server } from '@/test/msw-server'
import {
  KnowledgeHubPicker,
  type KnowledgeHubPickerMode,
} from '@/features/knowledge-hub'
import { clearSession, file as makeFile, renderComponent } from './harness'

function filesHandler(files: ReturnType<typeof makeFile>[]) {
  return [
    http.get('/api/knowledge-hub/folders', () => HttpResponse.json({ data: [] })),
    http.get('/api/knowledge-hub/files', () => HttpResponse.json({ data: files })),
  ]
}

function audioMode(onConfirm: KnowledgeHubPickerMode['onConfirm']): KnowledgeHubPickerMode {
  return {
    allowedTypes: ['audio'],
    selection: 'single',
    confirmVerbKey: 'knowledgeHub.picker.verb.insertAudio',
    emptyKey: 'knowledgeHub.picker.empty.audio',
    onConfirm,
  }
}

beforeEach(() => clearSession())
afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('KnowledgeHubPicker', () => {
  test('disables files whose kind is not allowed (audio-only mode)', async () => {
    server.use(
      ...filesHandler([
        makeFile({ id: 'aud', name: 'clip.mp3', contentType: 'audio/mpeg' }),
        makeFile({ id: 'doc', name: 'notes.pdf', contentType: 'application/pdf' }),
      ]),
    )
    renderComponent('owner', <KnowledgeHubPicker open onOpenChange={() => {}} mode={audioMode(() => {})} />)
    expect(await screen.findByTestId('kh-picker-select-aud')).toBeEnabled()
    expect(screen.getByTestId('kh-picker-select-doc')).toBeDisabled()
  })

  test('single-select confirm returns exactly the chosen file (AC6a)', async () => {
    const onConfirm = vi.fn()
    server.use(...filesHandler([makeFile({ id: 'aud', name: 'clip.mp3', contentType: 'audio/mpeg' })]))
    renderComponent('owner', <KnowledgeHubPicker open onOpenChange={() => {}} mode={audioMode(onConfirm)} />)
    fireEvent.click(await screen.findByTestId('kh-picker-select-aud'))
    fireEvent.click(screen.getByTestId('kh-picker-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm.mock.calls[0][0]).toHaveLength(1)
    expect(onConfirm.mock.calls[0][0][0].id).toBe('aud')
  })

  test('single-select replaces the prior choice rather than accumulating (AC6)', async () => {
    const onConfirm = vi.fn()
    server.use(
      ...filesHandler([
        makeFile({ id: 'a', name: 'a.mp3', contentType: 'audio/mpeg' }),
        makeFile({ id: 'b', name: 'b.mp3', contentType: 'audio/mpeg' }),
      ]),
    )
    renderComponent('owner', <KnowledgeHubPicker open onOpenChange={() => {}} mode={audioMode(onConfirm)} />)
    fireEvent.click(await screen.findByTestId('kh-picker-select-a'))
    fireEvent.click(screen.getByTestId('kh-picker-select-b'))
    fireEvent.click(screen.getByTestId('kh-picker-confirm'))
    expect(onConfirm.mock.calls[0][0]).toHaveLength(1)
    expect(onConfirm.mock.calls[0][0][0].id).toBe('b')
  })

  test('canceling clears the selection so a reopen starts clean (AC6)', async () => {
    // The parent keeps `open` true and ignores onOpenChange, so the internal
    // reset is observable directly: after cancel, the prior pick is gone.
    server.use(...filesHandler([makeFile({ id: 'aud', contentType: 'audio/mpeg' })]))
    renderComponent('owner', <KnowledgeHubPicker open onOpenChange={() => {}} mode={audioMode(() => {})} />)
    fireEvent.click(await screen.findByTestId('kh-picker-select-aud'))
    expect(screen.getByTestId('kh-picker-confirm')).toBeEnabled()
    fireEvent.click(screen.getByTestId('kh-picker-cancel'))
    await waitFor(() => expect(screen.getByTestId('kh-picker-confirm')).toBeDisabled())
  })

  test('audio-only mode shows the empty state when a folder holds only non-audio files (PC1)', async () => {
    server.use(...filesHandler([makeFile({ id: 'doc', name: 'notes.pdf', contentType: 'application/pdf' })]))
    renderComponent('owner', <KnowledgeHubPicker open onOpenChange={() => {}} mode={audioMode(() => {})} />)
    // The per-seam empty copy fires because nothing is *selectable*, not just
    // when the folder is physically empty.
    expect(await screen.findByTestId('kh-picker-empty')).toHaveTextContent('audio')
    expect(screen.queryByTestId('kh-picker-file-doc')).not.toBeInTheDocument()
  })

  test('multi-select accumulates multiple files (AC6b)', async () => {
    const onConfirm = vi.fn()
    server.use(
      ...filesHandler([
        makeFile({ id: 'a', name: 'a.pdf', contentType: 'application/pdf' }),
        makeFile({ id: 'b', name: 'b.pdf', contentType: 'application/pdf' }),
      ]),
    )
    const mode: KnowledgeHubPickerMode = {
      allowedTypes: 'all',
      selection: 'multi',
      confirmVerbKey: 'knowledgeHub.picker.verb.attach',
      emptyKey: 'knowledgeHub.picker.empty.materials',
      onConfirm,
    }
    renderComponent('owner', <KnowledgeHubPicker open onOpenChange={() => {}} mode={mode} />)
    fireEvent.click(await screen.findByTestId('kh-picker-select-a'))
    fireEvent.click(screen.getByTestId('kh-picker-select-b'))
    fireEvent.click(screen.getByTestId('kh-picker-confirm'))
    expect(onConfirm.mock.calls[0][0]).toHaveLength(2)
  })

  test('renders the per-seam empty state when there is nothing to pick', async () => {
    server.use(...filesHandler([]))
    renderComponent('owner', <KnowledgeHubPicker open onOpenChange={() => {}} mode={audioMode(() => {})} />)
    const empty = await screen.findByTestId('kh-picker-empty')
    expect(empty).toHaveTextContent('audio')
  })

  test('confirm is disabled until something is selected', async () => {
    server.use(...filesHandler([makeFile({ id: 'aud', contentType: 'audio/mpeg' })]))
    renderComponent('owner', <KnowledgeHubPicker open onOpenChange={() => {}} mode={audioMode(() => {})} />)
    await screen.findByTestId('kh-picker-select-aud')
    expect(screen.getByTestId('kh-picker-confirm')).toBeDisabled()
  })

  test('has no accessibility violations', async () => {
    server.use(...filesHandler([makeFile({ id: 'aud', contentType: 'audio/mpeg' })]))
    const { container } = renderComponent(
      'owner',
      <KnowledgeHubPicker open onOpenChange={() => {}} mode={audioMode(() => {})} />,
    )
    await screen.findByTestId('kh-picker-select-aud')
    await waitFor(() => expect(screen.queryByTestId('kh-picker-list')).toBeInTheDocument())
    expect(await axe(container)).toHaveNoViolations()
  })
})
