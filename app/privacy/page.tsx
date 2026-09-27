import type { Metadata } from 'next'
import { HelpArticle, HelpShell, type HelpPage } from '@/features/help'
import { loadHelpPage } from '@/shared/lib/help-page-server'
import { Contact, LegalPage } from '@/shared/ui/legal/LegalPage'

export const metadata: Metadata = { title: 'Chính sách quyền riêng tư' }

// Bản admin soạn trong Quản trị → Hướng dẫn & chính sách (008500) nếu có; chưa có thì dùng bản viết sẵn dưới đây
export default async function PrivacyPage() {
  const page = await loadHelpPage<HelpPage>('privacy')
  if (page?.body?.trim()) return <HelpShell back={null}><HelpArticle page={page} /></HelpShell>
  return (
    <LegalPage title="Chính sách quyền riêng tư">
      <p>
        RaceHub là ứng dụng chạy bộ cộng đồng: ghi nhận bài chạy, thử thách, câu lạc bộ (CLB) và giải chạy ảo. Chính sách này giải thích
        chúng tôi thu thập dữ liệu gì, dùng để làm gì và quyền của bạn với dữ liệu đó.
      </p>
      <section>
        <h2>1. Dữ liệu chúng tôi thu thập</h2>
        <ul>
          <li><strong>Tài khoản:</strong> email, tên hiển thị, ảnh đại diện, khu vực (nếu bạn nhập).</li>
          <li><strong>Bài chạy:</strong> quãng đường, thời gian, pace, nhịp tim (nếu có), tuyến đường GPS — từ tính năng chạy trong ứng dụng
            hoặc từ tài khoản Strava bạn chủ động liên kết.</li>
          <li><strong>Hoạt động trong ứng dụng:</strong> CLB tham gia, thử thách, giải chạy, quà tặng, Xu, nhiệm vụ, bình luận, tin nhắn CLB.</li>
          <li><strong>Thanh toán:</strong> thông tin đơn hàng (gói, số tiền, mã đơn). Chúng tôi <strong>không lưu</strong> thông tin thẻ hay tài khoản ngân hàng của bạn;
            chuyển khoản thực hiện qua ứng dụng ngân hàng của bạn.</li>
          <li><strong>Đọc bài Kiến thức Runner:</strong> bài đã xem / đã lưu / tiến độ đọc và góp ý của bạn — để bạn đọc tiếp, nhận huy hiệu chuỗi bài; ban biên tập chỉ xem số liệu tổng hợp.</li>
          <li><strong>Thiết bị:</strong> đăng ký nhận thông báo đẩy (nếu bạn bật), mã lỗi kỹ thuật ẩn danh để sửa lỗi.</li>
        </ul>
      </section>
      <section>
        <h2>2. Dữ liệu từ Strava</h2>
        <ul>
          <li>Chỉ khi bạn bấm <strong>Kết nối Strava</strong> và đồng ý. Quyền yêu cầu: đọc hồ sơ và bài hoạt động (kể cả bài riêng tư) để tính
            thử thách, giải chạy và phần thưởng.</li>
          <li>Dữ liệu Strava chỉ dùng để phục vụ chính bạn trong RaceHub. Chúng tôi <strong>không bán</strong>, không chia sẻ cho bên thứ ba vì mục đích
            quảng cáo, và <strong>không dùng để huấn luyện mô hình AI</strong>.</li>
          <li>Khi bạn kết nối Strava, <strong>quãng đường và thời gian</strong> bài chạy từ Strava hiện trên bảng tin CLB, bảng xếp hạng, thử thách và giải chạy
            bạn tham gia. <strong>Bản đồ tuyến, từng km, nhịp tim chỉ bạn xem.</strong> Bạn tắt chia sẻ bất cứ lúc nào ở Cài đặt → Quyền riêng tư;
            khi tắt, bài vẫn tính Xu, XP, huy hiệu cho riêng bạn.</li>
          <li>Bạn có thể <strong>ngắt kết nối Strava</strong> bất cứ lúc nào trong Cài đặt; khi đó RaceHub thu hồi quyền truy cập và ngừng nhận dữ liệu mới.
            Nếu bạn xóa bài trên Strava, bài tương ứng trên RaceHub cũng bị gỡ.</li>
        </ul>
      </section>
      <section>
        <h2>3. Chúng tôi dùng dữ liệu để</h2>
        <ul>
          <li>Tính km, XP, cấp độ, thành tích thử thách / giải chạy, bảng xếp hạng.</li>
          <li>Chống gian lận (phát hiện bài đi xe, GPS nhảy…) để công bằng cho mọi người.</li>
          <li>Gửi thông báo bạn đã bật (bài chạy đã về, phần thưởng, hoạt động CLB).</li>
          <li>Vận hành CLB, giải chạy, vinh danh theo lựa chọn của Ban tổ chức và của bạn.</li>
        </ul>
      </section>
      <section>
        <h2>4. Ai nhìn thấy dữ liệu của bạn</h2>
        <ul>
          <li>Thành viên CLB / người tham gia cùng thử thách thấy tên, ảnh đại diện, thành tích trên bảng xếp hạng.</li>
          <li>Ban tổ chức giải chạy thấy danh sách vận động viên và kết quả của giải họ tổ chức.</li>
          <li>Được vinh danh: bạn có thể đổi ảnh hoặc ẩn mình khỏi ảnh vinh danh công khai.</li>
          <li>Nhà cung cấp hạ tầng (máy chủ, cơ sở dữ liệu, gửi thông báo) xử lý dữ liệu thay chúng tôi theo hợp đồng bảo mật.</li>
        </ul>
      </section>
      <section>
        <h2>4b. Quanh đây (Runner Nearby) — vị trí gần đúng</h2>
        <ul>
          <li>Tính năng <strong>tắt theo mặc định</strong>. Chỉ bật khi bạn đồng ý rõ ràng; bạn rút lại đồng ý bằng cách tắt Quanh đây trong ứng dụng.</li>
          <li>Chúng tôi chỉ lưu <strong>ô lưới khoảng 1 km</strong> bạn chọn (vị trí điện thoại lấy <strong>một lần</strong> ở độ chính xác thấp, hoặc điểm bạn chạm trên
            bản đồ) — <strong>không lưu toạ độ chính xác</strong>, không lấy từ GPS bài chạy, không theo dõi liên tục hay khi ứng dụng chạy nền.</li>
          <li>Vị trí <strong>tự hết hạn</strong> sau 24 giờ, 7 hoặc 30 ngày (bạn chọn) và bị xoá ngay khi bạn bấm “Ẩn tôi ngay” hoặc tắt tính năng.
            Mỗi ngày chỉ đổi vị trí tối đa 3 lần, số lần tìm kiếm bị giới hạn để không ai dò được vị trí của người khác.</li>
          <li>Người khác chỉ thấy <strong>tên gọi và chữ cái đầu của họ</strong>, ảnh đại diện, cấp độ, <strong>khoảng cách ước chừng</strong> (đã làm tròn và cộng sai số cố định),
            tên khu vực bạn tự đặt và các sở thích chạy bạn chọn chia sẻ (pace điển hình, mục tiêu, khung giờ, giới thiệu ngắn).</li>
          <li>Bạn chọn <strong>ai thấy mình</strong> (runner đã xác minh / chỉ cùng giới / chỉ thành viên CLB chung). Chỉ tài khoản có ít nhất 3 bài chạy hợp lệ mới
            dùng được tính năng. Hai người chỉ thấy nhau khi cài đặt của <strong>cả hai</strong> đều cho phép.</li>
          <li>Bạn có thể chặn hoặc báo cáo bất kỳ ai; người bị báo cáo không biết ai báo cáo. Báo cáo được quản trị viên xem xét; tài khoản nhận nhiều báo cáo
            bị tạm ẩn khỏi Quanh đây trong lúc chờ xử lý.</li>
          <li>Phiên bản đầu <strong>không có nhắn tin riêng</strong>: sau khi kết nối, hai bên chỉ rủ nhau vào buổi chạy nhóm công khai hoặc CLB.</li>
        </ul>
      </section>
      <section>
        <h2>5. Lưu trữ và bảo mật</h2>
        <p>
          Dữ liệu được mã hóa khi truyền, phân quyền truy cập chặt chẽ; token Strava lưu ở vùng máy chủ riêng, không lộ ra trình duyệt.
          Chúng tôi giữ dữ liệu trong thời gian bạn còn dùng tài khoản; sổ giao dịch Xu được lưu vết để đối soát.
        </p>
      </section>
      <section>
        <h2>6. Quyền của bạn</h2>
        <ul>
          <li>Xem, sửa hồ sơ và cài đặt quyền riêng tư trong ứng dụng.</li>
          <li>Ngắt kết nối Strava, tắt thông báo, tắt Quanh đây (xoá vị trí ngay) bất cứ lúc nào.</li>
          <li><strong>Xóa tài khoản và dữ liệu</strong>: tự xoá ngay trong app (Tôi → Cài đặt → Xoá tài khoản) — tuyến GPS, hồ sơ, ảnh, kết nối Strava bị xoá, phần còn lại ẩn danh; hoá đơn giao dịch được giữ ẩn danh theo quy định kế toán. Hoặc liên hệ qua <Contact />, chúng tôi xử lý trong tối đa 30 ngày.</li>
        </ul>
      </section>
      <section>
        <h2>7. Trẻ em</h2>
        <p>RaceHub dành cho người từ 13 tuổi. Người dưới 18 tuổi nên sử dụng khi có sự đồng ý của cha mẹ / người giám hộ.</p>
      </section>
      <section>
        <h2>8. Liên hệ và thay đổi</h2>
        <p>Mọi câu hỏi về quyền riêng tư: <Contact />. Khi chính sách thay đổi quan trọng, chúng tôi thông báo trong ứng dụng.</p>
      </section>
    </LegalPage>
  )
}
