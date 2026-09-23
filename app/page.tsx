'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/shared/lib/supabase'
import ChallengeTab from '@/features/challenge/components/ChallengeTab'
import ClubTab from '@/features/club/components/ClubTab'
import RunTab from '@/features/run/components/RunTab'
import FeedTab from '@/features/feed/components/FeedTab'
import AuthScreen from '@/features/auth/components/AuthScreen'
import ProfileTab from '@/features/profile/components/ProfileTab'
import { joinClubByCode } from '@/features/club/api'

// Định nghĩa từ điển đa ngôn ngữ (Localization Dictionary)
const translations = {
  vi: {
    brand: "RACEHUB",
    level: "Thành viên chính thức",
    xp: "Kinh nghiệm (XP)",
    xu: "Tài sản (Xu)",
    profileTitle: "Hồ sơ cá nhân",
    displayName: "Tên hiển thị (Leaderboard)",
    stravaStatus: "Trạng thái kết nối nguồn dữ liệu",
    nav: { home: "Home", challenge: "Challenge", run: "Run", club: "Club", profile: "Profile" }
  },
  en: {
    brand: "RACEHUB",
    level: "Official Member",
    xp: "Experience (XP)",
    xu: "Tokens (Xu)",
    profileTitle: "Runner Profile",
    displayName: "Display Name (Leaderboard)",
    stravaStatus: "Data Source Connection Status",
    nav: { home: "Home", challenge: "Challenge", run: "Run", club: "Club", profile: "Profile" }
  }
}

// Tách SearchParamHandler ra ngoài component chính để bọc Suspense an toàn cho Next.js build
const STRAVA_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Bạn đã hủy hoặc từ chối cấp quyền truy cập Strava.',
  account_conflict: 'Tài khoản Strava này đã được liên kết với một tài khoản khác trên hệ thống.',
  invalid_state: 'Phiên kết nối Strava không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.',
  auth_required: 'Bạn cần đăng nhập trước khi kết nối Strava.',
  server_error: 'Đã có lỗi hệ thống khi kết nối Strava. Vui lòng thử lại sau.',
}

function SearchParamHandler({ 
  setInitialClubId, 
  setCurrentTab,
  setStravaNotice,
  session 
}: { 
  setInitialClubId: (id: string) => void, 
  setCurrentTab: (tab: any) => void,
  setStravaNotice: (notice: { type: 'success' | 'error', message: string } | null) => void,
  session: any
}) {
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    // 1. Kiểm tra nếu có pending_join_code (sau khi đăng nhập xong từ link mời)
    const pendingCode = sessionStorage.getItem('pending_join_code')
    if (pendingCode && session) {
      sessionStorage.removeItem('pending_join_code')
      router.replace(`/club/join/${pendingCode}`)
      return
    }
    const pendingReferral = sessionStorage.getItem('pending_referral_id')
    if (pendingReferral && session) {
      sessionStorage.removeItem('pending_referral_id')
      router.replace(`/join/${pendingReferral}`)
      return
    }
    // 2. Xử lý query param điều hướng tab (?tab=club&clubId=... hoặc ?tab=profile)
    const tab = searchParams.get('tab')
    const clubId = searchParams.get('clubId')
    if (tab === 'club' && clubId) {
      setCurrentTab('club')
      setInitialClubId(clubId)
    } else if (tab === 'profile') {
      setCurrentTab('profile')
    }

    // 3. Xử lý kết quả kết nối Strava (?strava_success=true hoặc ?strava_error=...)
    const stravaSuccess = searchParams.get('strava_success')
    const stravaError = searchParams.get('strava_error')
    const referralSuccess = searchParams.get('referral_success')
    if (referralSuccess === 'true') {
      setStravaNotice({ type: 'success', message: 'Nhận thưởng giới thiệu thành công! 🎉' })
      setTimeout(() => setStravaNotice(null), 4000)
    }
        if (stravaSuccess === 'true') {
      setStravaNotice({ type: 'success', message: 'Kết nối Strava thành công! 🎉' })
      setTimeout(() => setStravaNotice(null), 4000)
    } else if (stravaError) {
      setStravaNotice({
        type: 'error',
        message: STRAVA_ERROR_MESSAGES[stravaError] || 'Đã có lỗi không xác định khi kết nối Strava.',
      })
      setTimeout(() => setStravaNotice(null), 6000)
    }

    // Dọn query params khỏi URL sau khi đã xử lý, tránh xử lý lặp lại khi reload
    if (tab || clubId || stravaSuccess || stravaError) {
      router.replace('/')
    }
    if (tab || clubId || stravaSuccess || stravaError || referralSuccess) {
      router.replace('/')
    }
  }, [searchParams, router, setInitialClubId, setCurrentTab, setStravaNotice, session])

  return null
}

export default function RaceHubApp() {
  const [currentTab, setCurrentTab] = useState<'home' | 'challenge' | 'run' | 'club' | 'profile'>('home')
  const [initialClubId, setInitialClubId] = useState<string | null>(null)
  const [lang, setLang] = useState<'vi' | 'en'>('vi')
  const [profile, setProfile] = useState<any>(null)
  const [clubs, setClubs] = useState<any[]>([])
  const t = translations[lang]
  const [session, setSession] = useState<any>(null)
  const [stravaNotice, setStravaNotice] = useState<{ type: 'success' | 'error', message: string } | null>(null)
  const [loadingAuth, setLoadingAuth] = useState(true)

  useEffect(() => {
  if (!session?.user?.id) return

  async function loadData() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()

    if (data) {
      setProfile(data)
    } else {
      // Hồ sơ + ví + thưởng chào mừng do máy chủ tạo (client không tự đặt số Xu)
      const { error: ensureError } = await supabase.rpc('ensure_profile')
      if (ensureError) {
        console.error('Không tạo được hồ sơ:', ensureError.message)
      } else {
        const { data: created } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
        if (created) setProfile(created)
      }
    }

    const { data: clubData } = await supabase.from('clubs').select('*').order('name', { ascending: true })
    if (clubData) setClubs(clubData)
    }
    loadData()
  }, [session])

  const handleProfileUpdated = () => {
    async function reloadProfile() {
      if (!session?.user?.id) return
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle()
      if (data) setProfile(data)
    }
    reloadProfile()
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoadingAuth(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setLoadingAuth(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex justify-center selection:bg-orange-500 selection:text-white">
        <div className="w-full max-w-md bg-slate-950 min-h-screen border-x border-slate-900 flex flex-col shadow-2xl relative items-center justify-center text-orange-500 font-bold text-xs"> 
          Đang khởi tạo bảo mật RaceHub...
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex justify-center selection:bg-orange-500 selection:text-white">
        <Suspense fallback={null}>
          <SearchParamHandler setInitialClubId={setInitialClubId} setCurrentTab={setCurrentTab} setStravaNotice={setStravaNotice} session={session} />
        </Suspense>
        <div className="w-full max-w-md bg-slate-950 min-h-screen border-x border-slate-900 flex flex-col shadow-2xl relative">
          <AuthScreen onAuthSuccess={() => window.location.reload()} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex justify-center selection:bg-orange-500 selection:text-white">
      <Suspense fallback={null}>
        <SearchParamHandler setInitialClubId={setInitialClubId} setCurrentTab={setCurrentTab} setStravaNotice={setStravaNotice} session={session} />
      </Suspense>
      <div className="w-full max-w-md bg-slate-950 min-h-screen border-x border-slate-900 flex flex-col shadow-2xl relative">
        
        {/* HEADER CỐ ĐỊNH */}
        <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 px-5 py-3.5 flex justify-between items-center">
          <h1 className="text-lg font-black tracking-wider text-orange-500 flex items-center gap-2">
            {t.brand} <span className="text-[9px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">v1.0</span>
          </h1>
          
          <div className="flex items-center gap-2.5">
            <button 
              onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}
              className="text-xs bg-slate-900 border border-slate-800 hover:border-orange-500 text-slate-300 px-2.5 py-1 rounded-full font-bold transition-all cursor-pointer"
            >
              🌐 {lang.toUpperCase()}
            </button>
            <span className="text-xs bg-slate-900 border border-slate-800 px-3 py-1 rounded-full text-slate-300 font-semibold">
              ⚡ {profile?.xp || 0} XP
            </span>
          </div>
        </header>
        {stravaNotice && (
          <div className={`mx-5 mt-3 px-4 py-2.5 rounded-xl text-sm font-semibold flex justify-between items-center ${
            stravaNotice.type === 'success' 
              ? 'bg-green-500/15 text-green-400 border border-green-500/30' 
              : 'bg-red-500/15 text-red-400 border border-red-500/30'
          }`}>
            <span>{stravaNotice.message}</span>
            <button onClick={() => setStravaNotice(null)} className="ml-3 opacity-70 hover:opacity-100 cursor-pointer">✕</button>
          </div>
        )}
        {/* NỘI DUNG TỪNG TAB */}
        <main className="flex-1 p-5 space-y-4 pb-32 overflow-y-auto">
          {currentTab === 'home' && (
            <div className="space-y-5 animate-fadeIn">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                <div className="flex items-center space-x-4">
                  <div className="w-14 h-14 bg-gradient-to-tr from-orange-500 to-amber-400 rounded-full flex items-center text-xl font-bold justify-center text-slate-950 shadow-lg">
                    {profile?.display_name?.charAt(0) || 'R'}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">{profile?.display_name || 'Runner'}</h2>
                    <p className="text-xs text-slate-400">Level {profile?.level || 1} • {t.level}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                    <span className="text-[11px] text-slate-400 block">{t.xp}</span>
                    <span className="text-base font-extrabold text-orange-400">{profile?.xp || 0} XP</span>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                    <span className="text-[11px] text-slate-400 block">{t.xu}</span>
                    <span className="text-base font-extrabold text-amber-400">{profile?.xu || 0} Xu</span>
                  </div>
                </div>
              </div>
              <FeedTab profile={profile} />
            </div>
          )}

          {currentTab === 'challenge' && (
            <div className="space-y-4 animate-fadeIn">
              <ChallengeTab profile={profile} challengeSubView="discover" setChallengeSubView={() => {}} />
            </div>
          )}

          {currentTab === 'run' && (
            <div className="space-y-4 animate-fadeIn">
              <RunTab profile={profile} onActivitySaved={() => console.log("Đã lưu hoạt động")} />
            </div>
          )}

          {currentTab === 'club' && (
            <div className="space-y-4 animate-fadeIn">
              <ClubTab profile={profile} onProfileUpdated={handleProfileUpdated} initialClubId={initialClubId} />
            </div>
          )}

          {currentTab === 'profile' && (
            <ProfileTab profile={profile} t={t} />
          )}
        </main>

        {/* THANH ĐIỀU HƯỚNG DƯỚI CỐ ĐỊNH */}
        <nav className="absolute bottom-0 left-0 right-0 bg-slate-950/95 backdrop-blur-lg border-t border-slate-800 py-3 px-4 z-50 shadow-2xl">
          <div className="max-w-md mx-auto grid grid-cols-5 gap-1 text-center items-center">
            <button 
              onClick={() => setCurrentTab('home')}
              className={`flex flex-col items-center py-1 transition-colors cursor-pointer ${currentTab === 'home' ? 'text-orange-500 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <span className="text-lg">🏠</span>
              <span className="text-[10px]">{t.nav.home}</span>
            </button>
            
            <button 
              onClick={() => setCurrentTab('challenge')}
              className={`flex flex-col items-center py-1 transition-colors cursor-pointer ${currentTab === 'challenge' ? 'text-orange-500 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <span className="text-lg">🎯</span>
              <span className="text-[10px]">{t.nav.challenge}</span>
            </button>

            <div className="flex justify-center">
              <button 
                onClick={() => setCurrentTab('run')}
                className={`w-12 h-12 rounded-full flex flex-col items-center justify-center shadow-lg transition-transform transform active:scale-95 cursor-pointer ${currentTab === 'run' ? 'bg-orange-600 text-white ring-4 ring-orange-500/30' : 'bg-gradient-to-tr from-orange-500 to-amber-400 text-slate-950 hover:opacity-90'}`}
              >
                <span className="text-xl">⚡</span>
              </button>
            </div>

            <button 
              onClick={() => setCurrentTab('club')}
              className={`flex flex-col items-center py-1 transition-colors cursor-pointer ${currentTab === 'club' ? 'text-orange-500 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <span className="text-lg">🛡️</span>
              <span className="text-[10px]">{t.nav.club}</span>
            </button>

            <button 
              onClick={() => setCurrentTab('profile')}
              className={`flex flex-col items-center py-1 transition-colors cursor-pointer ${currentTab === 'profile' ? 'text-orange-500 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <span className="text-lg">👤</span>
              <span className="text-[10px]">{t.nav.profile}</span>
            </button>
          </div>
        </nav>

      </div>
    </div>
  )
}