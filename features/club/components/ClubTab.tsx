'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/shared/lib/supabase'

// Import components từ cổng xuất chuẩn hoặc đường dẫn tính năng
import ClubMembersManager from '@/features/club/components/ClubMembersManager'
import ClubSettings, { ClubAvatar } from './ClubSettings'
import MyClubsRail from './MyClubsRail'

// Import toàn bộ API từ module features/club thay vì @/lib/clubApi
import {
  Club,
  ClubMember,
  ClubRole,
  ROLE_LABEL,
  clubErrorMessage,
  contributeTreasury,
  createClub,
  getClub,
  isStaff,
  joinClub,
  listClubs,
  listMembers,
  listMyMemberships, // MỚI: xem hướng dẫn thêm vào ../api
  removeMember,
  type MyMembership,
} from '../api'

interface ClubTabProps {
  profile: any
  onProfileUpdated: () => void
  initialClubId?: string | null
}

type SubTab = 'overview' | 'leaderboard' | 'activities' | 'members' | 'settings'

const CONTRIBUTION = 10
const PAGE_SIZE = 12

/* ================================================================= */
/* Toast — thay alert(). alert() khoá luồng và không nói được gì     */
/* ngoài một dòng chữ.                                               */
/* ================================================================= */

function useToast() {
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ text, tone })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 3200)
  }, [])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return { toast, show }
}

function Toast({ toast }: { toast: { text: string; tone: 'ok' | 'err' } | null }) {
  if (!toast) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-bold shadow-2xl border max-w-[90vw] ${
        toast.tone === 'ok'
          ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
          : 'bg-rose-950 text-rose-300 border-rose-700'
      }`}
    >
      {toast.text}
    </div>
  )
}

/* ================================================================= */

function RoleBadge({ role }: { role: ClubRole }) {
  const tone =
    role === 'OWNER'
      ? 'bg-amber-500/20 text-amber-400'
      : role === 'CAPTAIN'
      ? 'bg-orange-500/20 text-orange-400'
      : 'bg-slate-800 text-slate-300'
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${tone}`}>{ROLE_LABEL[role]}</span>
}

export default function ClubTab({ profile, onProfileUpdated }: ClubTabProps) {
  const userId: string | undefined = profile?.id

  const { toast, show } = useToast()

  const [clubs, setClubs] = useState<Club[]>([])
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null)
  const [clubDetail, setClubDetail] = useState<Club | null>(null)
  const [members, setMembers] = useState<ClubMember[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [subTab, setSubTab] = useState<SubTab>('overview')
  const [isCreating, setIsCreating] = useState(false)
  const [newClubName, setNewClubName] = useState('')
  const [newClubDesc, setNewClubDesc] = useState('')
  const [showInvite, setShowInvite] = useState(false)

  // CLB của tôi
  const [memberships, setMemberships] = useState<MyMembership[]>([])
  const [mineLoading, setMineLoading] = useState(true)
  const [activeMineId, setActiveMineId] = useState<string | null>(null)
  const discoverRef = useRef<HTMLElement>(null)

  /* --------------------------- Danh sách CLB --------------------------- */

  const refreshClubs = useCallback(
    async (q = '') => {
      try {
        setClubs(await listClubs(q))
      } catch (e) {
        show(clubErrorMessage(e), 'err')
      }
    },
    [show],
  )

  useEffect(() => {
    const t = setTimeout(() => { refreshClubs(search) }, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [search, refreshClubs])

  /* ------------------------ CLB tôi đã tham gia ------------------------ */

  const refreshMine = useCallback(async () => {
    if (!userId) return
    try {
      setMemberships(await listMyMemberships(userId))
    } catch (e) {
      show(clubErrorMessage(e), 'err')
    } finally {
      setMineLoading(false)
    }
  }, [userId, show])

  // Tải lần đầu và mỗi khi quay lại từ màn chi tiết (vai trò/thành viên có thể đã đổi)
  useEffect(() => {
    if (!selectedClubId) refreshMine()
  }, [selectedClubId, refreshMine])

  const myApproved = useMemo(
    () =>
      memberships
        .filter((m) => m.status === 'APPROVED')
        .sort(
          (a, b) =>
            Number(isStaff(b.role)) - Number(isStaff(a.role)) ||
            a.club.name.localeCompare(b.club.name, 'vi'),
        ),
    [memberships],
  )
  const statusByClub = useMemo(
    () => new Map(memberships.map((m) => [m.club.id, m.status])),
    [memberships],
  )

  // Giữ CLB đang chọn trên thanh biểu tượng; mặc định là CLB đầu tiên
  useEffect(() => {
    setActiveMineId((prev) =>
      prev && myApproved.some((m) => m.club.id === prev) ? prev : myApproved[0]?.club.id ?? null,
    )
  }, [myApproved])

  /* --------------------------- Chi tiết CLB ---------------------------- */

  const reloadMembers = useCallback(async (clubId: string) => {
    try {
      setMembers(await listMembers(clubId))
    } catch {
      /* bỏ qua lỗi realtime ngầm */
    }
  }, [])

  useEffect(() => {
    if (!selectedClubId) {
      setClubDetail(null)
      setMembers([])
      return
    }

    let cancelled = false
    setLoading(true)
    setSubTab('overview')
    setShowInvite(false)

    Promise.all([getClub(selectedClubId), listMembers(selectedClubId)])
      .then(([club, mems]) => {
        if (cancelled) return
        setClubDetail(club)
        setMembers(mems)
      })
      .catch((e) => {
        if (cancelled) return
        show(clubErrorMessage(e), 'err')
        setSelectedClubId(null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [selectedClubId, show])

  /* ---------------- Realtime: danh sách sống như nhóm chat -------------- */

  useEffect(() => {
    if (!selectedClubId) return
    const channel = supabase
      .channel(`club:${selectedClubId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'club_members', filter: `club_id=eq.${selectedClubId}` },
        () => reloadMembers(selectedClubId),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'clubs', filter: `id=eq.${selectedClubId}` },
        (payload) => setClubDetail((c) => (c ? { ...c, ...(payload.new as Club) } : c)),
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [selectedClubId, reloadMembers])

  /* -------------------- Trạng thái dẫn xuất ---------------------------- */

  const myMembership = useMemo(
    () => members.find((m) => m.user_id === userId) ?? null,
    [members, userId],
  )
  const myRole: ClubRole | null = myMembership?.status === 'APPROVED' ? myMembership.role : null

  const approved = useMemo(
    () =>
      members
        .filter((m) => m.status === 'APPROVED')
        .sort((a, b) => (b.profile?.xp ?? 0) - (a.profile?.xp ?? 0)),
    [members],
  )
  const pending = useMemo(() => members.filter((m) => m.status === 'PENDING'), [members])

  /* ------------------------------ Hành động ---------------------------- */

  const run = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setBusy(key)
      try {
        await fn()
      } catch (e) {
        show(clubErrorMessage(e), 'err')
      } finally {
        setBusy(null)
      }
    },
    [show],
  )

  const handleCreateClub = (e: React.FormEvent) => {
    e.preventDefault()
    run('create', async () => {
      const club = await createClub(newClubName, newClubDesc)
      show(`Đã thành lập "${club.name}".`)
      setNewClubName('')
      setNewClubDesc('')
      setIsCreating(false)
      await refreshClubs(search)
      setSelectedClubId(club.id)
    })
  }

  const handleJoin = () =>
    run('join', async () => {
      const row = await joinClub(selectedClubId!)
      await reloadMembers(selectedClubId!)
      show(row.status === 'APPROVED' ? 'Bạn đã vào Câu lạc bộ.' : 'Đã gửi yêu cầu, chờ Chủ nhiệm duyệt.')
    })

  // Tham gia ngay từ danh sách khám phá, không cần mở chi tiết
  const handleQuickJoin = (clubId: string) =>
    run(`join:${clubId}`, async () => {
      const row = await joinClub(clubId)
      show(row.status === 'APPROVED' ? 'Bạn đã vào Câu lạc bộ.' : 'Đã gửi yêu cầu, chờ Chủ nhiệm duyệt.')
      await Promise.all([refreshMine(), refreshClubs(search)])
    })

  const handleLeave = () => {
    if (!myMembership) return
    if (!confirm('Rời khỏi Câu lạc bộ này?')) return
    run('leave', async () => {
      await removeMember(myMembership.id)
      show('Bạn đã rời Câu lạc bộ.')
      setSelectedClubId(null)
      await refreshClubs(search)
    })
  }

  const handleContribute = () =>
    run('contribute', async () => {
      const balance = await contributeTreasury(selectedClubId!, CONTRIBUTION)
      setClubDetail((c) => (c ? { ...c, treasury_balance: balance } : c))
      onProfileUpdated()
      show(`Đã góp ${CONTRIBUTION} Xu vào quỹ.`)
    })

  const inviteLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/club/join/${
    clubDetail?.invite_code ?? ''
  }`

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      show('Đã sao chép link mời.')
    } catch {
      show('Trình duyệt chặn sao chép. Hãy chọn và copy thủ công.', 'err')
    }
  }

  const scrollToDiscover = () => discoverRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  /* ===================== MÀN CHI TIẾT CÂU LẠC BỘ ====================== */

  if (selectedClubId) {
    const staff = isStaff(myRole)

    return (
      <div className="space-y-4 animate-fadeIn text-xs">
        <Toast toast={toast} />

        <button
          onClick={() => setSelectedClubId(null)}
          className="text-xs text-orange-400 font-bold flex items-center gap-1 cursor-pointer bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800"
        >
          ← Quay lại danh sách Câu lạc bộ
        </button>

        {loading ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center text-slate-400">
            Đang tải dữ liệu Câu lạc bộ…
          </div>
        ) : !clubDetail ? null : (
          <>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center space-x-3 min-w-0">
                  <ClubAvatar club={clubDetail} size={48} />
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-white truncate">{clubDetail.name}</h2>
                    <p className="text-[10px] text-slate-400 truncate">
                      {clubDetail.member_count}/{clubDetail.member_limit} thành viên
                      {clubDetail.description ? ` · ${clubDetail.description}` : ''}
                    </p>
                  </div>
                </div>
                {staff && (
                  <button
                    onClick={() => setShowInvite((v) => !v)}
                    className="shrink-0 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold px-3 py-1.5 rounded-xl text-orange-400 border border-slate-700 cursor-pointer"
                  >
                    Mời thành viên
                  </button>
                )}
              </div>

              {showInvite && (
                <div className="mt-3 pt-3 border-t border-slate-800 flex gap-2">
                  <input
                    readOnly
                    value={inviteLink}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none"
                  />
                  <button
                    onClick={copyInvite}
                    className="bg-orange-500 text-slate-950 font-bold px-3 py-2 rounded-xl text-xs whitespace-nowrap cursor-pointer"
                  >
                    Sao chép
                  </button>
                </div>
              )}
            </div>

            {/* THANH TAB ĐIỀU HƯỚNG CÓ TÍCH HỢP TAB CÀI ĐẶT DÀNH CHO STAFF */}
            <div className={`grid ${staff ? 'grid-cols-5' : 'grid-cols-4'} gap-1 bg-slate-950 p-1.5 rounded-2xl border border-slate-800 text-center`}>
              {(
                [
                  ['overview', 'Tổng quan'],
                  ['leaderboard', 'Xếp hạng'],
                  ['activities', 'Thử thách'],
                  ['members', `Thành viên${staff && pending.length ? ` (${pending.length})` : ''}`],
                  ...(staff ? [['settings', 'Cài đặt'] as [SubTab, string]] : []),
                ] as [SubTab, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSubTab(key)}
                  className={`py-2 text-[10px] font-bold rounded-xl cursor-pointer transition-colors ${
                    subTab === key ? 'bg-orange-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* ---------------------- CÀI ĐẶT CLB ---------------------- */}
            {subTab === 'settings' && staff && (
              <ClubSettings
                club={clubDetail}
                myRole={myRole}
                onChanged={setClubDetail}
                onDeleted={() => {
                  setSelectedClubId(null)
                  refreshClubs(search)
                }}
                notify={show}
              />
            )}

            {/* ---------------------- TỔNG QUAN ---------------------- */}
            {subTab === 'overview' && (
              <div className="space-y-4 animate-fadeIn">
                {/* Thông báo ghim (đặt trong tab Cài đặt, hiển thị ở đây cho mọi thành viên) */}
                {clubDetail.announcement && (
                  <div className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4 space-y-1">
                    <span className="text-[10px] font-bold text-orange-400 block">Thông báo ghim</span>
                    <p className="text-xs text-slate-200 whitespace-pre-line">{clubDetail.announcement}</p>
                  </div>
                )}

                <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 space-y-3 shadow-xl">
                  <span className="text-[10px] text-slate-400 block">Quỹ Câu lạc bộ</span>
                  <div className="flex justify-between items-center gap-3">
                    <span className="text-xl font-black text-amber-400">
                      {clubDetail.treasury_balance.toLocaleString('vi-VN')} Xu
                    </span>

                    {myRole ? (
                      <button
                        onClick={handleContribute}
                        disabled={busy === 'contribute'}
                        className="bg-orange-500/25 hover:bg-orange-500/35 disabled:opacity-50 text-orange-400 text-xs font-bold px-3.5 py-2 rounded-xl cursor-pointer border border-orange-500/30"
                      >
                        {busy === 'contribute' ? 'Đang góp…' : `Góp ${CONTRIBUTION} Xu`}
                      </button>
                    ) : myMembership?.status === 'PENDING' ? (
                      <span className="text-xs bg-amber-500/20 text-amber-400 px-3 py-1.5 rounded-xl font-bold">
                        Đang chờ duyệt
                      </span>
                    ) : myMembership?.status === 'BANNED' ? (
                      <span className="text-xs bg-rose-500/20 text-rose-400 px-3 py-1.5 rounded-xl font-bold">
                        Bị hạn chế
                      </span>
                    ) : (
                      <button
                        onClick={handleJoin}
                        disabled={busy === 'join'}
                        className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg cursor-pointer"
                      >
                        {busy === 'join' ? 'Đang gửi…' : 'Tham gia'}
                      </button>
                    )}
                  </div>

                  {myRole && (
                    <p className="text-[10px] text-slate-500">
                      Vai trò của bạn: <span className="text-slate-300 font-bold">{ROLE_LABEL[myRole]}</span>
                    </p>
                  )}
                </div>

                {myMembership && myMembership.role !== 'OWNER' && (
                  <button
                    onClick={handleLeave}
                    disabled={busy === 'leave'}
                    className="w-full text-[11px] text-rose-400 font-bold py-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 cursor-pointer"
                  >
                    Rời khỏi Câu lạc bộ
                  </button>
                )}
              </div>
            )}

            {/* ---------------------- XẾP HẠNG ---------------------- */}
            {subTab === 'leaderboard' && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-xl animate-fadeIn">
                <h3 className="text-sm font-bold text-slate-300">Xếp hạng theo XP</h3>
                {approved.length === 0 ? (
                  <p className="text-slate-500 text-center py-4">Chưa có thành viên chính thức.</p>
                ) : (
                  <div className="space-y-2">
                    {approved.map((m, i) => (
                      <div
                        key={m.id}
                        className={`p-3 rounded-xl border flex justify-between items-center ${
                          m.user_id === userId ? 'bg-orange-500/10 border-orange-500/40' : 'bg-slate-950 border-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-black text-orange-400 w-5 shrink-0">{i + 1}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-white truncate">{m.profile?.display_name ?? 'Runner'}</h4>
                              <RoleBadge role={m.role} />
                            </div>
                            <span className="text-[10px] text-slate-400">Level {m.profile?.level ?? 1}</span>
                          </div>
                        </div>
                        <span className="text-amber-400 font-bold shrink-0">{(m.profile?.xp ?? 0).toLocaleString('vi-VN')} XP</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ---------------------- THỬ THÁCH ---------------------- */}
            {subTab === 'activities' && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-2 shadow-xl animate-fadeIn">
                <h3 className="text-sm font-bold text-slate-300">Chưa có thử thách nào</h3>
                <p className="text-slate-400 text-xs">
                  Thử thách do Ban Chủ nhiệm phát hành sẽ xuất hiện ở đây.
                </p>
              </div>
            )}

            {/* ---------------------- THÀNH VIÊN ---------------------- */}
            {subTab === 'members' && (
              <ClubMembersManager
                clubId={selectedClubId}
                myRole={myRole}
                notify={show}
              />
            )}
          </>
        )}
      </div>
    )
  }

  /* ========================= MÀN DANH SÁCH ========================== */

  const myIds = new Set(myApproved.map((m) => m.club.id))
  const discover = clubs.filter((c) => !myIds.has(c.id))
  const shown = discover.slice(0, visibleCount)

  return (
    <div className="space-y-6 animate-fadeIn text-xs">
      <Toast toast={toast} />

      <div className="flex justify-between items-center gap-3">
        <h2 className="text-base font-bold text-white">Câu lạc bộ</h2>
        <button
          onClick={() => setIsCreating((v) => !v)}
          className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-bold px-3.5 py-2 rounded-xl shadow-md cursor-pointer shrink-0"
        >
          {isCreating ? 'Đóng' : 'Thành lập CLB'}
        </button>
      </div>

      {isCreating && (
        <form onSubmit={handleCreateClub} className="bg-slate-900 border border-orange-500/50 rounded-2xl p-4 space-y-3 shadow-xl animate-fadeIn">
          <h3 className="text-sm font-bold text-orange-400">Thành lập Câu lạc bộ mới</h3>
          <div>
            <label htmlFor="club-name" className="text-[10px] text-slate-400 block mb-1">
              Tên Câu lạc bộ
            </label>
            <input
              id="club-name"
              value={newClubName}
              onChange={(e) => setNewClubName(e.target.value)}
              maxLength={60}
              placeholder="Tây Hồ Runners"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white outline-none focus:border-orange-500"
            />
          </div>
          <div>
            <label htmlFor="club-desc" className="text-[10px] text-slate-400 block mb-1">
              Mô tả
            </label>
            <textarea
              id="club-desc"
              value={newClubDesc}
              onChange={(e) => setNewClubDesc(e.target.value)}
              maxLength={200}
              placeholder="Nơi giao lưu của các runner khu vực Tây Hồ"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white outline-none focus:border-orange-500 h-20 resize-none"
            />
          </div>
          <button
            type="submit"
            disabled={busy === 'create' || !newClubName.trim()}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-slate-950 font-black py-2.5 rounded-xl text-xs cursor-pointer shadow-lg shadow-orange-500/20"
          >
            {busy === 'create' ? 'Đang tạo…' : 'Thành lập'}
          </button>
        </form>
      )}

      {/* ══════════ 1. CLB CỦA TÔI (luôn ở trên cùng) ══════════ */}
      <section aria-labelledby="my-clubs" className="space-y-2">
        <h3 id="my-clubs" className="text-sm font-bold text-white">
          CLB của tôi
          {myApproved.length > 0 && <span className="ml-1.5 text-slate-500 font-medium">{myApproved.length}</span>}
        </h3>
        <MyClubsRail
          items={myApproved.map((m) => ({ club: m.club, role: m.role }))}
          activeId={activeMineId}
          loading={mineLoading}
          onSelect={setActiveMineId}
          onOpen={setSelectedClubId}
          onFind={scrollToDiscover}
          onCreate={() => setIsCreating(true)}
        />
      </section>

      {/* ══════════ 2. KHÁM PHÁ ══════════ */}
      <section ref={discoverRef} aria-labelledby="discover" className="space-y-3 scroll-mt-4">
        <h3 id="discover" className="text-sm font-bold text-white">
          Khám phá Câu lạc bộ
        </h3>

        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setVisibleCount(PAGE_SIZE)
          }}
          placeholder="Tìm Câu lạc bộ theo tên…"
          aria-label="Tìm Câu lạc bộ theo tên"
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-orange-500"
        />

        {discover.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-400">
            {search
              ? 'Không tìm thấy Câu lạc bộ nào khớp.'
              : myApproved.length > 0
              ? 'Bạn đã tham gia tất cả Câu lạc bộ hiện có.'
              : 'Chưa có Câu lạc bộ nào. Hãy thành lập cái đầu tiên.'}
          </div>
        ) : (
          <ul className="space-y-2.5">
            {shown.map((club) => {
              const status = statusByClub.get(club.id)
              const full = club.member_count >= club.member_limit
              return (
                <li
                  key={club.id}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex items-center gap-3 shadow-lg"
                >
                  <button
                    onClick={() => setSelectedClubId(club.id)}
                    className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer group"
                  >
                    <ClubAvatar club={club} size={44} />
                    <span className="min-w-0">
                      <span className="block font-bold text-[13px] text-white group-hover:text-orange-400 transition-colors truncate">
                        {club.name}
                      </span>
                      <span className="block text-[10px] text-slate-400 truncate">
                        {club.description ?? 'Câu lạc bộ tập luyện cộng đồng.'}
                      </span>
                      <span className="block text-[10px] text-slate-500 mt-0.5">
                        {club.member_count}/{club.member_limit} thành viên
                      </span>
                    </span>
                  </button>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-lg font-bold">
                      {club.treasury_balance.toLocaleString('vi-VN')} Xu
                    </span>
                    {status === 'PENDING' ? (
                      <span className="text-[11px] text-amber-400 font-bold py-1">Chờ duyệt</span>
                    ) : status === 'BANNED' ? (
                      <span className="text-[11px] text-rose-400 font-bold py-1">Bị hạn chế</span>
                    ) : full ? (
                      <span className="text-[11px] text-slate-500 font-bold py-1">Đã đầy</span>
                    ) : (
                      <button
                        onClick={() => handleQuickJoin(club.id)}
                        disabled={busy === `join:${club.id}`}
                        className="border border-orange-500 text-orange-400 hover:bg-orange-500 hover:text-slate-950 disabled:opacity-50 font-bold text-[11px] px-3 py-1 rounded-lg cursor-pointer transition-colors"
                      >
                        {busy === `join:${club.id}` ? 'Đang gửi…' : 'Tham gia'}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {discover.length > shown.length && (
          <button
            onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
            className="w-full bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-semibold py-2.5 rounded-xl cursor-pointer"
          >
            Xem thêm ({discover.length - shown.length})
          </button>
        )}
      </section>
    </div>
  )
}
