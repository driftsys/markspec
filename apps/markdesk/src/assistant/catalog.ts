import type { AssistantId } from "../shell/bridge";

/** Static facts about one supported assistant CLI, for the install guide. */
export interface AssistantInfo {
  id: AssistantId;
  name: string;
  description: string;
  /** Official install page, opened in the system browser. */
  installPage: string;
  /** Example install commands. MarkDesk only shows them; it never runs them. */
  installCommands: readonly { label: string; command: string }[];
  signInCommand: string;
  signInNote?: string;
}

/** The supported assistants, in display order. */
export const ASSISTANTS: readonly AssistantInfo[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Anthropic's coding assistant for the terminal.",
    installPage: "https://code.claude.com/docs/en/setup",
    installCommands: [
      {
        label: "macOS / Linux",
        command: "curl -fsSL https://claude.ai/install.sh | bash",
      },
      {
        label: "Windows (PowerShell)",
        command: "irm https://claude.ai/install.ps1 | iex",
      },
      { label: "Homebrew", command: "brew install --cask claude-code" },
      { label: "WinGet", command: "winget install Anthropic.ClaudeCode" },
    ],
    signInCommand: "claude auth login",
  },
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI's coding assistant for the terminal.",
    installPage: "https://learn.chatgpt.com/docs/codex/cli",
    installCommands: [
      {
        label: "macOS / Linux",
        command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
      },
      { label: "npm", command: "npm install -g @openai/codex" },
    ],
    signInCommand: "codex login",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    description: "GitHub's coding assistant for the terminal.",
    installPage: "https://github.com/github/copilot-cli",
    installCommands: [
      {
        label: "macOS / Linux",
        command: "curl -fsSL https://gh.io/copilot-install | bash",
      },
      { label: "Homebrew", command: "brew install copilot-cli" },
      { label: "WinGet", command: "winget install GitHub.Copilot" },
      { label: "npm", command: "npm install -g @github/copilot" },
    ],
    signInCommand: "copilot",
    signInNote: "Then type /login.",
  },
];

/** Display name of an assistant. */
export function assistantName(id: AssistantId): string {
  return ASSISTANTS.find((info) => info.id === id)?.name ?? id;
}
