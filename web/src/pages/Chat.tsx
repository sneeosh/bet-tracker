import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getPlayers } from '../api';

interface Message {
  id: number;
  sender: 'user' | 'system';
  text: string;
  timestamp: Date;
}

export default function Chat() {
  const { id: leagueId } = useParams<{ id: string }>();
  const [players, setPlayers] = useState<any[]>([]);
  const [selectedPhone, setSelectedPhone] = useState('');
  const [playerInfo, setPlayerInfo] = useState<{ playerName: string; teamName: string; state: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  let nextId = useRef(0);

  useEffect(() => {
    if (leagueId) {
      getPlayers(leagueId).then(setPlayers);
    }
  }, [leagueId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!selectedPhone) {
      setPlayerInfo(null);
      setMessages([]);
      return;
    }
    fetch(`/api/chat/state/${encodeURIComponent(selectedPhone)}`)
      .then((r) => r.json())
      .then((data) => {
        setPlayerInfo(data);
        setMessages([{
          id: nextId.current++,
          sender: 'system',
          text: `Connected as ${data.playerName} (${data.teamName}). State: ${data.state}\n\nType a message to interact with the bot.`,
          timestamp: new Date(),
        }]);
      });
  }, [selectedPhone]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !selectedPhone || sending) return;

    const userMsg: Message = {
      id: nextId.current++,
      sender: 'user',
      text: input.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: selectedPhone, message: userMsg.text }),
      });
      const data = await res.json();

      const botMsg: Message = {
        id: nextId.current++,
        sender: 'system',
        text: data.response ?? data.error ?? 'No response',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMsg]);

      if (data.state && playerInfo) {
        setPlayerInfo({ ...playerInfo, state: data.state });
      }
    } catch {
      setMessages((prev) => [...prev, {
        id: nextId.current++,
        sender: 'system',
        text: 'Error: could not reach the server.',
        timestamp: new Date(),
      }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 20 }}>
      <h2>Chat Testing</h2>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: 4 }}>
          Chat as:
        </label>
        <select
          value={selectedPhone}
          onChange={(e) => setSelectedPhone(e.target.value)}
          style={{ width: '100%', padding: 8, fontSize: 16 }}
        >
          <option value="">Select a player...</option>
          {players.map((p) => (
            <option key={p.id} value={p.phone}>
              {p.name} — {p.team_name} ({p.phone})
            </option>
          ))}
        </select>
      </div>

      {playerInfo && (
        <div style={{
          fontSize: 13,
          color: '#666',
          marginBottom: 8,
          padding: '4px 8px',
          background: '#f0f0f0',
          borderRadius: 4,
        }}>
          State: <strong>{playerInfo.state}</strong>
        </div>
      )}

      <div style={{
        border: '1px solid #ccc',
        borderRadius: 8,
        height: 400,
        overflowY: 'auto',
        padding: 12,
        marginBottom: 12,
        background: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
              padding: '8px 12px',
              borderRadius: 12,
              background: msg.sender === 'user' ? '#0071e3' : '#e9e9eb',
              color: msg.sender === 'user' ? '#fff' : '#000',
              whiteSpace: 'pre-wrap',
              fontSize: 14,
              lineHeight: 1.4,
            }}
          >
            {msg.text}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={sendMessage} style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={selectedPhone ? 'Type a message...' : 'Select a player first'}
          disabled={!selectedPhone || sending}
          style={{
            flex: 1,
            padding: '10px 12px',
            fontSize: 16,
            border: '1px solid #ccc',
            borderRadius: 8,
          }}
        />
        <button
          type="submit"
          disabled={!selectedPhone || sending || !input.trim()}
          style={{
            padding: '10px 20px',
            fontSize: 16,
            background: '#0071e3',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: selectedPhone && !sending ? 'pointer' : 'not-allowed',
            opacity: selectedPhone && !sending ? 1 : 0.5,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
