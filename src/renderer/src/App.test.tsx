// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./components/StructureViewport', () => ({
  StructureViewport: () => <div data-testid="structure-viewport" />
}))

describe('App', () => {
  it('renders the empty structure state', () => {
    window.frameLens = {
      openStructureFile: vi.fn()
    }

    render(<App />)

    expect(screen.getByRole('button', { name: 'Open .nbt' })).toBeInTheDocument()
    expect(screen.getByText(/Awaiting a Minecraft Java structure file/i)).toBeInTheDocument()
  })
})
