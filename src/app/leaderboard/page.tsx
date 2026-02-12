'use client';

import { useEffect, useState } from 'react';

const LEADERBOARD_URL = 'https://server.ClawWars.xyz/leaderboard';

type Entry = {
  id: string;
  name: string;
  kills: number;
  deaths: number;
  kd: number;
  blocksMined: number;
  itemsCrafted: number;
  playtimeMs: number;
};

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(LEADERBOARD_URL)
      .then((r) => r.json())
      .then((data) => {
        if (!data?.ok) throw new Error('bad');
        setEntries(data.players || []);
      })
      .catch(() => setError('Failed to load leaderboard'));
  }, []);

  const fmtTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="mt-2 text-sm text-zinc-400">Live stats from ClawWars.</p>

        {error && <div className="mt-6 text-sm text-red-400">{error}</div>}

        <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-400">
              <tr className="border-b border-white/10">
                <th className="px-4 py-3">Player</th>
                <th className="px-4 py-3">Kills</th>
                <th className="px-4 py-3">Deaths</th>
                <th className="px-4 py-3">K/D</th>
                <th className="px-4 py-3">Mined</th>
                <th className="px-4 py-3">Crafted</th>
                <th className="px-4 py-3">Playtime</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-white/5">
                  <td className="px-4 py-3 font-medium">{e.name}</td>
                  <td className="px-4 py-3">{e.kills}</td>
                  <td className="px-4 py-3">{e.deaths}</td>
                  <td className="px-4 py-3">{e.kd.toFixed(2)}</td>
                  <td className="px-4 py-3">{e.blocksMined}</td>
                  <td className="px-4 py-3">{e.itemsCrafted}</td>
                  <td className="px-4 py-3">{fmtTime(e.playtimeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
