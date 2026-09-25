import type { Metadata } from 'next'
import { Contact, LegalPage } from '@/shared/ui/legal/LegalPage'

export const metadata: Metadata = { title: 'Chính sách quyền riêng tư' }

export default function PrivacyPage() {
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
          <li>Bài chạy của bạn chỉ hiện cho người khác theo cài đặt quyền riêng tư của bạn (mặc định bản đồ tuyến chạy là riêng tư).</li>
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
          <li>Ngắt kết nối Strava, tắt thông báo bất cứ lúc nào.</li>
          <li>Yêu cầu <strong>xóa tài khoản và dữ liệu</strong>: liên hệ qua <Contact />. Chúng tôi xử lý trong tối đa 30 ngày.</li>
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
