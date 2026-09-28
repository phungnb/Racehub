#!/usr/bin/env python3
# Liệt kê mọi câu chữ RaceHub gửi / hiện cho người dùng → docs/THONG_BAO_NGUOI_DUNG.md
# Chạy lại sau khi sửa code: python3 scripts/list-messages.py
# Nguồn: thông báo (private.notify / notify_club — chỉ lấy bản mới nhất của mỗi hàm SQL), mã lỗi → câu báo, toast, giọng HLV.
import os, re, glob, json
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
mig=sorted(glob.glob(ROOT+'/supabase/migrations/2026*.sql'))
# 1. Thông báo: bản mới nhất của mỗi hàm
fn_re=re.compile(r'create or replace function\s+([\w.]+)\s*\(', re.I)
latest={}
for f in mig:
    s=open(f).read()
    for m in fn_re.finditer(s):
        start=m.start()
        # end: first "\nend $$;" or "\n$$;" after start
        e=re.search(r'\n(end \$\$;|\$\$;)', s[start:])
        body=s[start:start+(e.end() if e else 4000)]
        latest[m.group(1).lower()]=(os.path.basename(f), body)
def split_args(s):
    out=[];depth=0;cur='';q=False;i=0
    while i<len(s):
        c=s[i]
        if q:
            cur+=c
            if c=="'":
                if i+1<len(s) and s[i+1]=="'": cur+="'"; i+=1
                else: q=False
        elif c=="'": q=True; cur+=c
        elif c in '([': depth+=1; cur+=c
        elif c in ')]':
            if depth==0: out.append(cur.strip()); return out
            depth-=1; cur+=c
        elif c==',' and depth==0: out.append(cur.strip()); cur=''
        else: cur+=c
        i+=1
    return out
def pretty(expr):
    expr=' '.join(expr.split())
    parts=re.split(r"\s*\|\|\s*", expr)
    res=''
    for p in parts:
        m=re.fullmatch(r"(E)?'((?:[^']|'')*)'", p)
        if m: res+=m.group(2).replace("''","'")
        elif p.lower() in ('null',): return ''
        else: res+='{'+re.sub(r'^(private\.|public\.)','',p)[:40]+'}'
    return res
notes=[]
for name,(f,body) in latest.items():
    for m in re.finditer(r'private\.(notify_club|notify)\s*\(', body):
        args=split_args(body[m.end():])
        if m.group(1)=='notify' and len(args)>=6: kind,title,msg=args[2],args[3],args[4]
        elif m.group(1)=='notify_club' and len(args)>=6: kind,title,msg=args[2],args[3],args[4]
        else: continue
        notes.append((pretty(kind).strip("{}") or kind, pretty(title), pretty(msg), name.split('.')[-1], f))
seen=set(); uniq=[]
for n in notes:
    k=(n[1],n[2])
    if k in seen: continue
    seen.add(k); uniq.append(n)
uniq.sort(key=lambda x:(x[0],x[1]))
# 2-4. Frontend
def walk(exts):
    for d in ('app','features','shared'):
        for r,_,fs in os.walk(ROOT+'/'+d):
            for x in fs:
                if x.endswith(exts) and '.test.' not in x: yield os.path.join(r,x)
toasts=[];errors=[]
tre=re.compile(r"toast(?:\.(success|error|info|warning))?\(\s*(['`])((?:(?!\2).)*[À-ỹ](?:(?!\2).)*)\2")
ere=re.compile(r"^\s*([A-Z][A-Z0-9_]{2,}):\s*'((?:[^'\\]|\\.)*[À-ỹ](?:[^'\\]|\\.)*)'",re.M)
for p in walk(('.ts','.tsx')):
    s=open(p).read(); rel=os.path.relpath(p,ROOT)
    for m in tre.finditer(s):
        ln=s[:m.start()].count('\n')+1
        toasts.append((m.group(1) or 'info', m.group(3), f'{rel}:{ln}'))
    if re.search(r'(errors|Api)\.ts$|errorMessage|ERROR', rel) or 'MESSAGES' in s or 'ERRORS' in s:
        for m in ere.finditer(s):
            ln=s[:m.start()].count('\n')+1
            errors.append((m.group(1), m.group(2), f'{rel}:{ln}'))

coach=re.findall(r"return (?:autoPauseOn \? )?[`']([^`']+)[`']", open(ROOT+'/features/run/model/coach.ts').read())
# Câu đọc ghép trong tracker.ts / useRunTracker.ts
coach=['Hoàn thành {km} ki lô mét. Pace {phút} phút {giây} giây. Thời gian chạy {phút} phút.']+[c for c in coach if 'splitAnnouncement' not in c]
coach+=re.findall(r"say\('([^']+)'\)", open(ROOT+'/features/run/hooks/useRunTracker.ts').read())
review=[('Bài có tốc độ như đi xe / chạy nhanh bất thường','Tốc độ có đoạn bất thường.'),('Mất GPS phần lớn bài / nối thẳng quá nhanh','Mất tín hiệu GPS một đoạn.'),
        ('Không có điểm GPS','Thiếu dữ liệu GPS.'),('Chọn "Chỉ tính phần có GPS"','Chỉ tính phần có GPS.'),('Phần có GPS dưới 200 m','Quãng đường có GPS dưới 200 m.'),
        ('Trùng giờ với bài khác cùng tài khoản','Trùng giờ với bài chạy khác.'),('Bài dưới 200 m','Quá ngắn (< 200 m), không đủ điều kiện ghi nhận.')]
cell=lambda x: str(x).replace('|','\\|').replace('\n',' ').strip() or '—'
L=['# Toàn bộ câu chữ gửi đến người dùng','',
   'Tạo tự động bằng `python3 scripts/list-messages.py` — **không sửa tay**. Muốn đổi câu nào: gửi số mục (vd **A12**) hoặc chép câu cũ → câu mới.','',
   '`{…}` là phần tự điền (tên người, số km, số Xu…). Một số câu ghép theo điều kiện nên hiện dạng `{case when …}`.','',
   f'Tổng: {len(uniq)} thông báo · {len(review)} lời báo bài chạy · {len(coach)} câu giọng HLV · {len(errors)} câu báo lỗi · {len(toasts)} thông báo nhanh (toast).','',
   '## A. Thông báo (chuông + thông báo đẩy)','','| # | Loại | Tiêu đề | Nội dung | Phát sinh ở |','|---|---|---|---|---|']
for i,(k,t,b,fn,f) in enumerate(uniq,1): L.append(f'| A{i} | {cell(k)} | {cell(t)} | {cell(b)} | `{fn}` |')
L+=['','## B. Lời báo trạng thái bài chạy','','| # | Khi nào | Câu hiện cho người chạy |','|---|---|---|']
for i,(w,t) in enumerate(review,1): L.append(f'| B{i} | {w} | {t} |')
L+=['','## C. Giọng huấn luyện viên (đọc to khi chạy)','','| # | Câu đọc |','|---|---|']
for i,t in enumerate(coach,1): L.append(f'| C{i} | {cell(t.replace("${e.minutes}","{số phút}"))} |')
L+=['','## D. Câu báo lỗi','']
cur=None;n=0
for code,msg,loc in sorted(errors, key=lambda x:(x[2].split(':')[0], int(x[2].split(':')[1]))):
    f=loc.split(':')[0]
    if f!=cur:
        cur=f; L+=['',f'**{f}**','','| # | Mã | Câu báo |','|---|---|---|']
    n+=1; L.append(f'| D{n} | `{code}` | {cell(msg)} |')
L+=['','## E. Thông báo nhanh (toast)','','| # | Kiểu | Câu | Vị trí |','|---|---|---|---|']
for i,(k,m,loc) in enumerate(sorted(toasts, key=lambda x:x[2]),1): L.append(f'| E{i} | {k} | {cell(m)} | `{loc}` |')
open(ROOT+'/docs/THONG_BAO_NGUOI_DUNG.md','w').write('\n'.join(L)+'\n')
print('A',len(uniq),'B',len(review),'C',len(coach),'D',len(errors),'E',len(toasts))
