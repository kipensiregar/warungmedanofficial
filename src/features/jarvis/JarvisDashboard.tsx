import { Bot, CircleHelp, Package, ReceiptText, Send, Sparkles, Store, TrendingUp } from 'lucide-react'
import './jarvis.css'

const reportCards = [
  {
    title: 'Ringkasan penjualan',
    description: 'Ringkasan penjualan harian dan bulanan.',
    icon: TrendingUp,
  },
  {
    title: 'Ringkasan stok bahan baku',
    description: 'Posisi stok dan bahan yang perlu diperiksa.',
    icon: Package,
  },
  {
    title: 'Ringkasan pengeluaran',
    description: 'Pengeluaran dan arus kas usaha.',
    icon: ReceiptText,
  },
  {
    title: 'Perbandingan cabang dan bazar',
    description: 'Perbandingan laporan antarunit usaha.',
    icon: Store,
  },
]

export default function JarvisDashboard() {
  return (
    <div className="jarvis-page">
      <header className="jarvis-heading">
        <div>
          <p className="eyebrow">ASISTEN LAPORAN CT CATERING</p>
          <h1>Jarvis</h1>
          <p className="jarvis-intro">Ringkasan bisnis dan ruang tanya jawab dalam satu tempat.</p>
        </div>
        <span className="jarvis-status"><span className="jarvis-status-dot" /> Fondasi UI</span>
      </header>

      <div className="jarvis-notice" role="status">
        <CircleHelp size={18} aria-hidden="true" />
        <p>Belum terhubung ke data laporan. Tidak ada data yang dimuat atau ditampilkan.</p>
      </div>

      <section aria-labelledby="jarvis-reports-title">
        <div className="jarvis-section-heading">
          <div>
            <h2 id="jarvis-reports-title">Laporan bisnis</h2>
            <p>Bagian laporan siap dihubungkan pada tahap berikutnya.</p>
          </div>
          <span className="jarvis-section-tag">BACA SAJA</span>
        </div>
        <div className="jarvis-report-grid">
          {reportCards.map(({ title, description, icon: Icon }) => (
            <article className="jarvis-report-card" key={title}>
              <div className="jarvis-card-icon"><Icon size={20} aria-hidden="true" /></div>
              <div className="jarvis-card-copy">
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              <span className="jarvis-card-status">Belum terhubung</span>
            </article>
          ))}
        </div>
      </section>

      <section className="jarvis-chat" aria-labelledby="jarvis-chat-title">
        <div className="jarvis-chat-heading">
          <div className="jarvis-chat-avatar"><Bot size={21} aria-hidden="true" /></div>
          <div>
            <h2 id="jarvis-chat-title">Tanya Jarvis</h2>
            <p>Asisten laporan · Belum terhubung</p>
          </div>
          <Sparkles className="jarvis-chat-sparkle" size={20} aria-hidden="true" />
        </div>

        <div className="jarvis-answer" aria-live="polite">
          <span className="jarvis-answer-label">AREA JAWABAN</span>
          <p>Jawaban Jarvis akan muncul di sini setelah integrasi AI diaktifkan.</p>
        </div>

        <form className="jarvis-prompt" onSubmit={event => event.preventDefault()}>
          <label className="sr-only" htmlFor="jarvis-question">Pertanyaan untuk Jarvis</label>
          <input
            id="jarvis-question"
            type="text"
            placeholder="Tulis pertanyaan tentang laporan…"
            autoComplete="off"
            aria-describedby="jarvis-chat-status"
          />
          <button type="submit" disabled aria-label="Kirim pertanyaan, belum terhubung">
            <Send size={17} aria-hidden="true" />
            <span>Belum terhubung</span>
          </button>
        </form>
        <p id="jarvis-chat-status" className="jarvis-chat-footnote">Pertanyaan belum dikirim. Chat akan aktif setelah integrasi disiapkan.</p>
      </section>
    </div>
  )
}
