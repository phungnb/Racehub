'use client';

import { useState } from 'react';
import { Users, UserPlus, Shield, Lock, Unlock, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';

interface TeamRosterManagerProps {
  challengeId?: string;
  isLocked?: boolean;
}

export default function TeamRosterManager({ challengeId, isLocked = false }: TeamRosterManagerProps) {
  // Dữ liệu mẫu minh họa cho hệ thống quản lý đội hình
  const [teams, setTeams] = useState([
    { id: 'team-1', name: 'Đội A - Mãnh Hổ', members: ['Nguyễn Bá Phụng', 'Trần Văn An', 'Lê Hoàng'] },
    { id: 'team-2', name: 'Đội B - Gió Lốc', members: ['Phạm Minh Tuấn', 'Hoàng Thu Trang'] },
  ]);

  const [unassignedMembers, setUnassignedMembers] = useState([
    'Vũ Đình Nam', 'Đỗ Hoàng Long', 'Bùi Thị Hoa'
  ]);

  const [locked, setLocked] = useState(isLocked);
  const [newTeamName, setNewTeamName] = useState('');

  const handleAddTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim() || locked) return;
    setTeams([...teams, { id: `team-${Date.now()}`, name: newTeamName, members: [] }]);
    setNewTeamName('');
  };

  const handleAssignMember = (memberName: string, targetTeamId: string) => {
    if (locked) return;
    // Xóa khỏi unassigned
    setUnassignedMembers(unassignedMembers.filter(m => m !== memberName));
    // Thêm vào team mục tiêu
    setTeams(teams.map(team => {
      if (team.id === targetTeamId) {
        return { ...team, members: [...team.members, memberName] };
      }
      return team;
    }));
  };

  const handleRemoveMember = (memberName: string, teamId: string) => {
    if (locked) return;
    // Xóa khỏi team
    setTeams(teams.map(team => {
      if (team.id === teamId) {
        return { ...team, members: team.members.filter(m => m !== memberName) };
      }
      return team;
    }));
    // Đẩy lại vào danh sách chờ
    setUnassignedMembers([...unassignedMembers, memberName]);
  };

  return (
    <div className="bg-[#18191a] border border-[#2f3031] rounded-2xl p-6 text-white space-y-6 shadow-xl max-w-5xl mx-auto">
      
      {/* Header Module */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-[#2f3031] pb-4 gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center space-x-2">
            <Users className="w-5 h-5 text-amber-500" />
            <span>Quản Lý Đội Hình & Phân Chia Team (Draft Management)</span>
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Sắp xếp vận động viên vào các đội trước khi Challenge chính thức khởi tranh.</p>
        </div>

        {/* Trạng thái khóa đội hình */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setLocked(!locked)}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all ${
              locked 
                ? 'bg-red-500/10 border border-red-500/30 text-red-400' 
                : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            }`}
          >
            {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            <span>{locked ? 'Đã Khóa Đội Hình (Locked)' : 'Đang Mở Sắp Xếp (Editable)'}</span>
          </button>
        </div>
      </div>

      {/* Form tạo Team mới (chỉ hiện khi chưa khóa) */}
      {!locked && (
        <form onSubmit={handleAddTeam} className="flex gap-3 bg-[#242526] p-4 rounded-xl border border-[#3a3b3c]">
          <input 
            type="text"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="Nhập tên đội mới (VD: Đội C - Sấm Sét)..."
            className="flex-1 bg-[#18191a] border border-[#3a3b3c] rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
          />
          <button 
            type="submit"
            className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 transition-all flex items-center space-x-1.5"
          >
            <UserPlus className="w-4 h-4" />
            <span>Tạo Đội Mới</span>
          </button>
        </form>
      )}

      {/* Khu vực danh sách VĐV chưa phân đội (Free Agents) */}
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center space-x-1.5">
            <AlertCircle className="w-4 h-4" />
            <span>Vận Động Viên Chờ Phân Bổ ({unassignedMembers.length})</span>
          </span>
        </div>
        
        {unassignedMembers.length === 0 ? (
          <p className="text-xs text-gray-500 italic">Tất cả vận động viên đã được xếp vào các đội.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {unassignedMembers.map((member, idx) => (
              <div key={idx} className="bg-[#242526] border border-[#3a3b3c] px-3 py-1.5 rounded-lg flex items-center space-x-2 text-xs">
                <span>{member}</span>
                {!locked && teams.length > 0 && (
                  <div className="flex items-center space-x-1 pl-2 border-l border-[#3a3b3c]">
                    {teams.map(t => (
                      <button
                        key={t.id}
                        onClick={() => handleAssignMember(member, t.id)}
                        className="text-[10px] bg-amber-500/20 hover:bg-amber-500 hover:text-white text-amber-300 px-1.5 py-0.5 rounded transition-all"
                        title={`Chuyển vào ${t.name}`}
                      >
                        {t.name.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lưới hiển thị các Đội và Thành viên */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {teams.map((team) => (
          <div key={team.id} className="bg-[#242526] border border-[#3a3b3c] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#3a3b3c] pb-2.5">
              <div className="flex items-center space-x-2">
                <Shield className="w-4 h-4 text-orange-400" />
                <span className="font-bold text-sm">{team.name}</span>
              </div>
              <span className="text-[11px] bg-[#18191a] px-2 py-0.5 rounded-full text-gray-400 border border-[#3a3b3c]">
                {team.members.length} thành viên
              </span>
            </div>

            {/* Danh sách thành viên trong đội */}
            <div className="space-y-1.5 min-h-[80px]">
              {team.members.length === 0 ? (
                <p className="text-xs text-gray-500 italic py-3 text-center">Chưa có thành viên nào trong đội.</p>
              ) : (
                team.members.map((member, mIdx) => (
                  <div key={mIdx} className="flex items-center justify-between bg-[#18191a] px-3 py-2 rounded-lg text-xs border border-[#2f3031]">
                    <span className="text-gray-200">{member}</span>
                    {!locked && (
                      <button
                        onClick={() => handleRemoveMember(member, team.id)}
                        className="text-gray-500 hover:text-red-400 transition-colors"
                        title="Đưa ra khỏi đội"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
