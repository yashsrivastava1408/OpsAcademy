import { useState } from 'react';
import { Bot, Send, X, Sparkles, AlertOctagon, Loader } from 'lucide-react';
import { agentApi } from '../../services/api';
import './MentorChat.css';

export default function MentorChat({ unitId, currentStep, onClose }) {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([
    {
      sender: 'mentor',
      text: "👋 Hi! I'm your OpsAcademy AI Mentor. Stuck on a command or concept? Ask me for a hint anytime!",
    },
  ]);
  const [loading, setLoading] = useState(false);

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!query.trim() || loading) return;

    const userText = query.trim();
    setQuery('');

    // Append user message
    setMessages((prev) => [...prev, { sender: 'user', text: userText }]);
    setLoading(true);

    try {
      const res = await agentApi.getHint(userText, unitId, currentStep);
      const data = res.data?.data;

      if (data?.blocked) {
        setMessages((prev) => [
          ...prev,
          {
            sender: 'mentor',
            text: data.message || '🚫 Security Warning: Suspicious command detected.',
            blocked: true,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            sender: 'mentor',
            text: data?.hint || '💡 Review the step instructions and check for syntax typos.',
          },
        ]);
      }
    } catch (err) {
      console.error('Failed to get AI hint:', err);
      setMessages((prev) => [
        ...prev,
        {
          sender: 'mentor',
          text: '💡 **Hint:** Check permissions with `ls -la` or verify command syntax.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mentor-chat-drawer glass-card animate-slide-left">
      <div className="mentor-chat-header">
        <div className="mentor-title-area">
          <div className="mentor-avatar">
            <Bot size={18} />
          </div>
          <div>
            <h3>AI Mentor</h3>
            <span className="mentor-status-text">
              <Sparkles size={12} /> RAG Guided (Multi-Agent)
            </span>
          </div>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="mentor-messages">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`mentor-msg ${msg.sender === 'user' ? 'msg-user' : 'msg-mentor'} ${
              msg.blocked ? 'msg-blocked' : ''
            }`}
          >
            {msg.sender === 'mentor' && (
              <div className="msg-avatar">
                {msg.blocked ? <AlertOctagon size={14} /> : <Bot size={14} />}
              </div>
            )}
            <div className="msg-bubble">
              <p>{msg.text}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="mentor-msg msg-mentor">
            <div className="msg-avatar">
              <Bot size={14} />
            </div>
            <div className="msg-bubble loading-bubble">
              <Loader size={16} className="spin" />
              <span>Analyzing container state & retrieving docs...</span>
            </div>
          </div>
        )}
      </div>

      <form className="mentor-input-form" onSubmit={handleSend}>
        <input
          type="text"
          className="input mentor-input"
          placeholder="Ask AI mentor for a hint..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-icon" disabled={loading || !query.trim()}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
