export interface OpenedFile {
  path: string
  name: string
  content: string
}

export interface SaveResult {
  path: string
  name: string
}

export type CloseDecision = 'saved' | 'discard' | 'cancelled'

export type MenuCommand = 'open' | 'save' | 'save-as'

export interface SeerMarkdownApi {
  openFile(): Promise<OpenedFile | null>
  saveFile(path: string, content: string): Promise<SaveResult>
  saveFileAs(content: string, suggestedName: string): Promise<OpenedFile | null>
  setDirty(dirty: boolean): void
  requestClose(): Promise<void>
  completeClose(decision: CloseDecision): void
  onInitialFile(listener: (file: OpenedFile) => void): () => void
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
  onCloseRequested(listener: () => void): () => void
}

declare global {
  interface Window {
    seerMarkdown: SeerMarkdownApi
  }
}
