'use client'

import { useState } from 'react'
import { supabase } from '@/shared/lib/supabase'
import CharacterHub from '@/features/character/components/CharacterHub'

export default function ProfileTab({ profile, t }: { profile: any, t: any }) {
  const [activeProfileTab, setActiveProfileTab] = useState<'character' | 'settings'>('character')
  const [displayName, setDisplayName] = useState(profile?.display_name || '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [copied, setCopied] = useState(false)
  
  const isStravaConnected = !!profile?.strava_connected

  const inviteLink = typeof window !== 'undefined' ? `${window.location.origin}/join/${profile?.id || 'racehub'}` : ''

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', profile.id)

      if (error) throw error
      setMessage('Cập nhật thành công!')
    } catch (err: any) {
      setMessage('Lỗi: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleConnectStrava = () => {
    // Server tự xác định người dùng từ phiên đăng nhập và tạo state có chữ ký
    window.location.href = '/api/connect/strava'
  }

  const handleDisconnectStrava = async () => {
    try {
      const res = await fetch('/api/connect/strava/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || res.statusText)
      window.location.reload()
    } catch (err: unknown) {
      alert('Không thể hủy kết nối: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.reload()
  }

  return (
    <div className="space-y-5 animate-fadeIn pb-10">
      <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs font-bold">
        <button
          onClick={() => setActiveProfileTab('character')}
          className={`flex-1 py-2.5 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${activeProfileTab === 'character' ? 'bg-orange-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
        >
          <span>🧑‍🎤</span> Nhân vật & Tủ đồ
        </button>
        <button
          onClick={() => setActiveProfileTab('settings')}
          className={`flex-1 py-2.5 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${activeProfileTab === 'settings' ? 'bg-orange-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
        >
          <span>⚙️</span> Hồ sơ & Cài đặt
        </button>
      </div>

      {activeProfileTab === 'character' ? (
        <CharacterHub userId={profile?.id} />
      ) : (
        <div className="space-y-4 animate-fadeIn">
          <div className="bg-gradient-to-r from-orange-950/40 via-slate-900 to-slate-900 border border-orange-500/30 rounded-2xl p-4 flex items-center justify-between shadow-xl">
            <div className="space-y-0.5">
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>🔗</span> Mời bạn bè tham gia
              </h3>
              <p className="text-[10px] text-slate-400">Chia sẻ đường dẫn hoặc QR để nhận thưởng Xu khi có runner mới tham gia.</p>
            </div>
            <button 
              onClick={() => setShowInviteModal(true)}
              className="bg-orange-600 hover:bg-orange-500 text-white font-bold px-3.5 py-2 rounded-xl text-xs transition-all cursor-pointer shadow-md whitespace-nowrap"
            >
              Mã QR & Link Mời
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-xl">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">✏️ {t?.displayName || 'Tên hiển thị'}</h3>
            <form onSubmit={handleUpdateProfile} className="space-y-3">
              <input 
                type="text" 
                value={displayName} 
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500 font-medium"
                placeholder="Nhập tên hiển thị..."
              />
              <button 
                type="submit" 
                disabled={saving}
                className="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all cursor-pointer shadow-lg"
              >
                {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
              {message && <p className="text-[11px] text-center text-orange-400 font-medium">{message}</p>}
            </form>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-xl">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">⌚ Thiết bị & Nguồn dữ liệu chạy bộ</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800/80">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-2">🏃 Strava</span>
                {isStravaConnected ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] bg-orange-500/20 text-orange-400 px-2.5 py-1 rounded-full font-bold">ĐÃ KẾT NỐI</span>
                    <button 
                      onClick={handleDisconnectStrava}
                      className="text-[10px] bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 px-2.5 py-1 rounded-full font-bold transition-all cursor-pointer"
                    >
                      Hủy
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={handleConnectStrava}
                    className="text-[10px] bg-slate-800 hover:bg-orange-600 text-slate-300 hover:text-white px-3 py-1 rounded-full font-bold transition-all cursor-pointer"
                  >
                    LIÊN KẾT
                  </button>
                )}
              </div>
              
              <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800/80">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-2">⌚ Garmin Connect</span>
                <button className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1 rounded-full font-bold transition-all cursor-pointer">LIÊN KẾT</button>
              </div>
              <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800/80">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-2">⌚ Coros App</span>
                <button className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1 rounded-full font-bold transition-all cursor-pointer">LIÊN KẾT</button>
              </div>
              <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800/80">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-2">⌚ Suunto App</span>
                <button className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1 rounded-full font-bold transition-all cursor-pointer">LIÊN KẾT</button>
              </div>
              <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800/80">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-2">🍏 Apple Health / Watch</span>
                <button className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1 rounded-full font-bold transition-all cursor-pointer">LIÊN KẾT</button>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button 
              onClick={handleSignOut}
              className="w-full bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/60 text-slate-300 hover:text-rose-400 font-bold py-3 rounded-xl text-xs transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              🚪 Đăng xuất tài khoản
            </button>
          </div>
        </div>
      )}

      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl animate-fadeIn text-center">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-white">Mời thành viên tham gia RaceHub</h3>
              <button onClick={() => setShowInviteModal(false)} className="text-slate-400 hover:text-white text-xs font-bold px-2 py-1 bg-slate-800 rounded-lg cursor-pointer">✕</button>
            </div>
            <div className="bg-white p-4 rounded-2xl w-40 h-40 mx-auto flex flex-col items-center justify-center shadow-inner">
              <div className="text-5xl">📷</div>
              <span className="text-[9px] text-slate-900 font-bold mt-2">Quét mã QR để vào App</span>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] text-slate-400">Hoặc sao chép đường dẫn mời trực tiếp:</p>
              <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-2">
                <input 
                  type="text" 
                  readOnly 
                  value={inviteLink} 
                  className="bg-transparent text-[11px] text-orange-400 w-full focus:outline-none truncate"
                />
                <button 
                  onClick={handleCopyLink}
                  className="ml-2 bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all whitespace-nowrap cursor-pointer"
                >
                  {copied ? 'Đã chép!' : 'Sao chép'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}