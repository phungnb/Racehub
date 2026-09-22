-- 1. Bảng lưu thông tin thử thách (Hỗ trợ cả Cá nhân & Đồng đội với các Game Mode)
CREATE TABLE IF NOT EXISTS challenges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  challenge_type TEXT NOT NULL CHECK (challenge_type IN ('INDIVIDUAL', 'TEAM')),
  game_mode TEXT CHECK (game_mode IN ('TEAM_SUM', 'TEAM_AVG', 'TEAM_GAP', 'LAST_MEMBER', 'ACCUMULATE', 'DISTANCE_TARGET', 'MILESTONE', 'STREAK')),
  target_km NUMERIC DEFAULT 0,
  min_km NUMERIC DEFAULT 2.0,
  min_members INTEGER DEFAULT 1,
  days INTEGER DEFAULT 30,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Bảng lưu danh sách các đội trong thử thách đồng đội
CREATE TABLE IF NOT EXISTS challenge_teams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Bảng liên kết vận động viên tham gia thử thách và đội tương ứng
CREATE TABLE IF NOT EXISTS challenge_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
  team_id UUID REFERENCES challenge_teams(id) ON DELETE SET NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PENDING', 'DROPPED')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(challenge_id, user_id)
);
