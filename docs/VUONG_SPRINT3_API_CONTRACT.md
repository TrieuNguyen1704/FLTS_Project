# Sprint 3 — Vương: Attempt Scoring API

## Phạm vi, trạng thái tích hợp

- Nguồn phân công: https://app.notion.com/p/Sprint-3-3fe054a7d04b80d1bb6de2c144dc8ce8
- Repo đích: `TrieuNguyen1704/FLTS_Project`; nhánh `feature/sprint3-vuong-quiz-attempts` từ main `5323d13`.
- Tham khảo repo `TrieuNguyen1704/FLTS` main `b90ea0d`: QuizAttemptController, LecturerQuizResultController, models/migrations attempts. Không merge/copy toàn repo.
- Chỉ triển khai schema **21–22**, hai model bài làm, Form Request, service chấm điểm, hai controller, routes và feature tests của Vương.
- **Phụ thuộc chưa có trong main lúc triển khai:** Khoa phụ trách production migrations 15–20 và models Quiz/LearningObject/QuizQuestion/QuizOption. Không chạy migration 21–22 trên MySQL trước khi có các bảng cha; không thể tuyên bố end-to-end production đã nghiệm thu khi thiếu phần Khoa.
- Test dùng schema fixture riêng trong `SprintThreeQuizApiTest` khi bảng cha chưa có. Đây là kiểm thử hợp đồng, không phải thay thế code Khoa. Khi Khoa tích hợp, chạy lại tests với schema thật, sửa fixture seed nếu cột bắt buộc bổ sung; không skip lỗi tích hợp.

## Hợp đồng schema với Khoa (bám tên cột Notion)

| Bảng cha | Cột phần Vương đọc |
| --- | --- |
| learning_objects | id, course_id, type='quiz', title, status |
| quizzes | id, learning_object_id, time_limit_minutes (null/0 = không giới hạn), passing_percentage (0–100) |
| quiz_questions | id, quiz_id, question_text, explanation, order_index, citation_metadata (JSON) |
| quiz_options | id, question_id, option_text, is_correct, order_index |

**Cần thống nhất khi review:** hiện chọn quiz có id lớn nhất của learning object đã published. Không giả định có cột `published_version_id` hoặc `learning_object_version_id` vì Notion chưa mô tả; nếu Khoa hỗ trợ published-version pointer như FLTS, phải cùng đổi selector sang đúng published version và test trước merge. Không tự lấy nguyên schema FLTS (`passing_score`, `quiz_question_id`, `question_index`, `citations`) vì khác tên trong phân công. Hai model relation tham chiếu model Quiz/QuizQuestion/QuizOption do Khoa cung cấp; luồng hiện đọc snapshot bằng query builder theo hợp đồng trên.

## Routes và xác thực

Tiền tố `B = /api/courses/{course}/learning-objects/{learningObject}`. Bearer token qua `auth.token` sẵn có, không đổi sang Sanctum hay viết auth mới. Lỗi theo envelope Laravel hiện tại (`message`, thêm `errors` khi validation); HTTP 401/403/404/409/422. Không tạo envelope lỗi khác với repo.

| Method | Route | Quyền |
| --- | --- | --- |
| POST | B/quiz-attempts | Student đã enrolled; chỉ quiz published trong đúng course |
| PATCH | B/quiz-attempts/{attempt} | Cùng student sở hữu bài làm, đúng course/object |
| POST | B/quiz-attempts/{attempt}/submit | Cùng student sở hữu bài làm |
| GET | B/quiz-attempts?page=1 | Lịch sử của chính student, phân trang 20 |
| GET | B/quiz-results?page=1 | Lecturer chủ sở hữu course, thống kê và danh sách phân trang 20 |
| GET | B/quiz-results/attempts/{attempt} | Lecturer chủ sở hữu course, chỉ bài completed trong đúng object |

Start trả 201 (kể cả resume), object `attempt`, `quiz` không có đáp án đúng/explanation/citation, `draft_answers`, `server_time`. Chỉ cần gọi lại start để resume; không tạo hai bài active khi hai request start đồng thời trên MySQL.

Draft và submit dùng cùng payload:

```json
{
  "draft_version": 0,
  "answers": [
    {"question_id": 11, "selected_option_id": 42, "time_spent_seconds": 15},
    {"question_id": 12, "selected_option_id": null, "time_spent_seconds": 3}
  ]
}
```

Hưng tự gọi autosave mỗi 15 giây theo phân công frontend. API nhận **toàn bộ bản nháp**, không phải patch từng câu; trường answers bắt buộc có, cho phép rỗng hoặc thiếu câu chưa làm. `draft_version` dùng giá trị mới nhất server trả. Lưu thành công tăng version 1. HTTP 409 nghĩa client cũ: gọi start để resume rồi cho người dùng xử lý, không tự ghi đè bằng dữ liệu tab cũ. Frontend serialize autosave/submit, chờ autosave đang chạy xong rồi dùng version mới để submit. `time_spent_seconds` là số tích lũy theo câu do client báo (0–86400), không cộng dồn mỗi lần save.

Sau submit, server trả `attempt` (score, max_score, passed, duration_seconds...), `results` chứa từng câu, lựa chọn, correct_option_id, is_correct, explanation, citation_metadata, time_spent_seconds; thêm `timed_out`. Không render HTML/LaTeX ở backend; frontend xử lý hiển thị an toàn. Nộp lại bài đã completed trả cùng kết quả, không tạo thêm answer.

## Quy tắc chấm điểm và thời gian

- Một câu có 2–10 lựa chọn, đúng một đáp án đúng; quiz từ 1–100 câu, tối đa 1.000 lựa chọn được đọc vào bộ nhớ. Quiz không hợp lệ không được bắt đầu. Mỗi câu 1 điểm, câu bỏ trống sai.
- `score` là phần trăm 0–100 (làm tròn 2 số); `max_score` là tổng số câu. Số câu đúng có thể đếm từ results. `passed = score >= passing_percentage` tại thời điểm start. Bỏ qua score/passed do client gửi.
- Snapshot questions/options/explanation/citations/passing threshold được giữ riêng trong `quiz_snapshot` khi start; giảng viên sửa đáp án sau đó không chấm sai bài đang làm. Không serialize snapshot thô cho sinh viên.
- Thời hạn `expires_at` do server đặt; đúng thời điểm hết giờ cũng coi quá hạn. Request sau hạn chỉ chấm **bản nháp server đã nhận trước hạn**, bỏ qua câu trả lời mới. `duration_seconds` tính bằng đồng hồ server, tối đa deadline nếu timeout, không tin client.
- Không có scheduler auto-submit trong phạm vi Vương. Bài hết hạn được chấm khi start/save/submit tiếp theo chạm tới. Nếu không có request mới, nó vẫn in_progress và không tính vào thống kê completed; cần job scheduler riêng nếu nhóm muốn chấm mọi bài ngay khi hết hạn.
- Transaction + row lock bảo vệ update/submit; lock quiz khi start để tuần tự hóa retake và attempt_number, unique constraint chống trùng. SQLite tests không chứng minh concurrency/row-lock MySQL; cần test tích hợp MySQL sau khi Khoa có schema.
- FK restrict giữ nguồn câu hỏi/options đang được bài làm tham chiếu; cập nhật nội dung phải theo version mới, không xóa vật lý câu hỏi đã có câu trả lời. Không cung cấp endpoint xóa lịch sử.
- Trong thời gian bài còn active chưa tạo answer row, FK chưa ngăn xóa câu hỏi/options gốc; phần editor/versioning của nhóm phải giữ các bản quiz đã published bất biến, không xóa chúng khi còn bài active.

## Thống kê và hiệu năng

`summary`: enrolled_students, participants (distinct student có bài completed), total_attempts, average_score/highest_score (tất cả bài completed), pass_rate (bài completed mới nhất của từng participant). `score_distribution`: số bài completed thuộc [0,50), [50,70), [70,90), [90,100]. Retake không làm tăng participants nhưng tăng total_attempts; không trộn hai mẫu số.

Tính COUNT/AVG/MAX/SUM trong SQL, danh sách 20 bản ghi/trang, chỉ select cột cần thiết; eager-load student chỉ id/name, không email; câu hỏi/options đọc hai query theo batch. Insert tối đa 100 answer trong một batch. Index attempts `(quiz_id,student_id,status,id)` cho resume/history, `(quiz_id,status,id)` cho results; unique `(quiz_id,student_id,attempt_number)`, unique answers `(quiz_attempt_id,question_id)`. Khoa cần index `quizzes.learning_object_id`, `quiz_questions(quiz_id,order_index)`, `quiz_options(question_id,order_index)` ở schema của mình.

Thời gian tương tác chỉ là dữ liệu client tự báo, **không phải bằng chứng gian lận, tương tác thật hay kết quả học tập**. Nhánh này không thêm engagement rubric/event tracking vì ngoài phân công.

## AI usage và bàn giao

Codex hỗ trợ đọc Notion, đối chiếu FLTS, viết code, contract fixtures/tests và tài liệu. Không dùng tài liệu sinh viên thật, không gửi API key lên Git, không gọi AI để chấm trắc nghiệm. Người review cần kiểm tra hợp đồng schema/version với Khoa và frontend autosave với Hưng. Không tự merge hay push main. Không sửa code repo FLTS tham khảo.
