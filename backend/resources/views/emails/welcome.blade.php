<p>Xin chào <strong>{{ $user->name }}</strong>,</p>
<p>Chúc mừng bạn đã đăng ký tài khoản thành công trên hệ thống <strong>FLTS</strong> với vai trò: <strong>{{ ucfirst($user->role) }}</strong>.</p>
<p>Bạn có thể đăng nhập vào hệ thống tại đường dẫn sau:</p>
<p><a href="{{ $loginUrl }}">{{ $loginUrl }}</a></p>
<p>Nếu bạn không thực hiện yêu cầu đăng ký này, vui lòng bỏ qua email.</p>
