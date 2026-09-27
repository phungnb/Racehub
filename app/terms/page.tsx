import type { Metadata } from 'next'
import { HelpArticle, HelpShell, type HelpPage } from '@/features/help'
import { loadHelpPage } from '@/shared/lib/help-page-server'
import Link from 'next/link'
import { Contact, LegalPage } from '@/shared/ui/legal/LegalPage'

export const metadata: Metadata = { title: 'Điều khoản sử dụng' }

// Bản admin soạn trong Quản trị → Hướng dẫn & chính sách (008500) nếu có; chưa có thì dùng bản viết sẵn dưới đây
export default async function TermsPage() {
  const page = await loadHelpPage<HelpPage>('terms')
  if (page?.body?.trim()) return <HelpShell back={null}><HelpArticle page={page} /></HelpShell>
  return (
    <LegalPage title="Điều khoản sử dụng">
      <p>Khi tạo tài khoản hoặc sử dụng RaceHub, bạn đồng ý với các điều khoản dưới đây và <Link href="/privacy" className="text-brand underline">Chính sách quyền riêng tư</Link>.</p>
      <section>
        <h2>1. Tài khoản</h2>
        <ul>
          <li>Bạn chịu trách nhiệm bảo mật tài khoản và mọi hoạt động dưới tài khoản của mình.</li>
          <li>Mỗi người một tài khoản. Tạo nhiều tài khoản để nhận thưởng, tặng quà cho chính mình hoặc thao túng bảng xếp hạng bị xem là gian lận.</li>
        </ul>
      </section>
      <section>
        <h2>2. Bài chạy và chống gian lận</h2>
        <ul>
          <li>Chỉ ghi nhận bài <strong>chạy bộ / đi bộ do chính bạn thực hiện</strong>. Bài đi xe, GPS giả, bài của người khác không được chấp nhận.</li>
          <li>Bài chạy thường ngày được ghi nhận tự động. Khi bạn tham gia thử thách, giải chạy hoặc chiến dịch, bài có dấu hiệu bất thường chờ Ban tổ chức duyệt, có thể bị từ chối và phần thưởng liên quan có thể bị thu hồi.</li>
          <li>Kết quả thử thách / giải chạy được chốt sau thời gian khiếu nại do hệ thống hoặc Ban tổ chức quy định.</li>
        </ul>
      </section>
      <section>
        <h2>3. Xu, quà tặng và gói trả phí</h2>
        <ul>
          <li><strong>Xu</strong> và <strong>Tỏa sáng</strong> là điểm trong ứng dụng, <strong>không có giá trị quy đổi thành tiền</strong>, không chuyển nhượng, không rút ra ngoài.</li>
          <li>RaceHub <strong>không tổ chức cá cược</strong> giữa người dùng. Phần thưởng thử thách là Xu do người tạo / quỹ CLB treo trước.</li>
          <li>Gói VIP / CLB Pro / nạp Xu thanh toán bằng chuyển khoản; được kích hoạt sau khi xác nhận. Khoản đã kích hoạt không hoàn tiền,
            trừ khi lỗi thuộc về RaceHub.</li>
          <li>Chương trình khuyến mãi có thời hạn và điều kiện riêng; chúng tôi có thể thu hồi phần thưởng nhận được bằng gian lận.</li>
        </ul>
      </section>
      <section>
        <h2>4. CLB, giải chạy và nội dung người dùng</h2>
        <ul>
          <li>Ban quản trị CLB / Ban tổ chức giải chịu trách nhiệm về nội dung, quỹ CLB, phí tham gia và phần thưởng họ công bố.</li>
          <li>Không đăng nội dung vi phạm pháp luật, xúc phạm, lừa đảo, quảng cáo trái phép hoặc xâm phạm quyền của người khác.
            Chúng tôi có thể gỡ nội dung và khóa tài khoản vi phạm.</li>
          <li>Bạn giữ quyền với nội dung của mình và cho phép RaceHub hiển thị nội dung đó trong phạm vi dịch vụ.</li>
        </ul>
      </section>
      <section>
        <h2>5. Sức khỏe và an toàn</h2>
        <p>
          Chạy bộ có rủi ro. Hãy tự đánh giá sức khỏe, tuân thủ luật giao thông và luôn đặt an toàn lên trên thành tích.
          RaceHub cung cấp công cụ ghi nhận và thi đấu ảo, không phải lời khuyên y tế.
        </p>
      </section>
      <section>
        <h2>6. Dịch vụ bên thứ ba</h2>
        <p>Kết nối Strava và các dịch vụ khác tuân theo điều khoản của bên đó. RaceHub không chịu trách nhiệm khi dịch vụ bên thứ ba gián đoạn.</p>
      </section>
      <section>
        <h2>7. Giới hạn trách nhiệm</h2>
        <p>
          Dịch vụ được cung cấp &quot;như hiện có&quot;. Trong phạm vi pháp luật cho phép, RaceHub không chịu trách nhiệm cho thiệt hại gián tiếp
          phát sinh từ việc sử dụng ứng dụng. Chúng tôi có thể thay đổi, tạm dừng tính năng để bảo trì hoặc nâng cấp.
        </p>
      </section>
      <section>
        <h2>8. Luật áp dụng và liên hệ</h2>
        <p>Điều khoản chịu sự điều chỉnh của pháp luật Việt Nam. Liên hệ: <Contact />.</p>
      </section>
    </LegalPage>
  )
}
