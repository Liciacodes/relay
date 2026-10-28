import { VoiceConsole } from "@/components/VoiceConsole";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 sm:px-8">
      <header className="flex items-baseline gap-3 pt-6">
        <h1 className="font-serif text-2xl font-medium text-text">Relay</h1>
        <p className="text-sm text-muted">Ask about your GitHub work, out loud.</p>
      </header>
      <VoiceConsole />
    </main>
  );
}
