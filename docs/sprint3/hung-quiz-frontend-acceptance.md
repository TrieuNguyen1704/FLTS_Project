# Sprint 3 — Nghiệm thu Frontend Quiz (Hưng)

- Nhánh: `feature/sprint3-hung-quiz-frontend`, HEAD `7bbe5a4`. Chưa push, chưa có upstream.
- Ngày lập: 2026-10-31.
- Frontend được viết theo contract của backend tham chiếu `/mnt/e/NCKH/FLTS`, chỉ đọc. Contract chi tiết nằm ở `/tmp/fast04-contract.md` (bản ngoài repo).

## Kết luận nhanh

| Hạng mục | Kết quả |
|---|---|
| Unit/mock test | **237/237 PASS** (`npm test`) |
| Build | PASS. `index.js` 160.1 kB (gzip 61.3 kB); chunk lớn nhất `MathText` (KaTeX) 260.7 kB (gzip 78.8 kB), lazy load |
| Xung đột với `origin/main` | **Không có.** `origin/main` chưa có commit mới kể từ merge-base `7b05844`; `git merge-tree` sạch |
| Khớp với backend của nhóm | **Chưa khớp.** Repo nhóm chưa có API learning-objects/generator/editor; API bài làm và kết quả của Vương dùng contract khác (mục g) |
| Khuyến nghị | **GO có điều kiện:** được push nhánh và mở **Draft PR** để review. **Chưa merge** cho đến khi thống nhất contract với Khoa và Vương. |

## a. Phạm vi đã giao so với tài liệu Sprint 3

| Hạng mục theo tài liệu | File thực tế | Ghi chú |
|---|---|---|
| Service `learningObjects.js` | `frontend/src/services/learningObjects.js` | Gồm list/show, attempt, kết quả, generator, editor, publish/archive, kết quả cho giảng viên |
| `QuizGeneratorModal.vue` | `frontend/src/views/QuizGeneratorModal.vue` (+ `src/quiz/generationPoller.js`, `quizGeneratorForm.js`) | Có xem trước nguồn, poll tiến độ, retry, chống tạo trùng bằng `request_id` |
| `QuizEditorView.vue` | `frontend/src/views/QuizEditorView.vue` (+ `src/quiz/quizEditorModel.js`, `components/MathText.vue`, `quiz/mathRender.js`) | Có publish/archive, xem trước LaTeX (KaTeX 0.19.0, pin cứng) |
| `StudentQuizPlayerView.vue` | `frontend/src/views/student/StudentQuizPlayerView.vue` (+ `src/quiz/quizSession.js`, `quizClock.js`) | Nằm trong thư mục `views/student/` |
| `LecturerQuizResultsView.vue` | `frontend/src/views/LecturerQuizResultsView.vue` (+ `src/quiz/quizResultsModel.js`) | Chỉ đọc |
| Danh sách quiz của khóa học | `frontend/src/components/CourseQuizList.vue` | Gắn vào `CourseWorkspaceView` |
| Test `QuizInteraction.test.mjs` | **Tách thành nhiều file:** `LearningObjects`, `QuizSession`, `QuizClock`, `StudentNavigation`, `QuizGenerator`, `QuizGeneratorModal`, `QuizEditor`, `QuizEditorView`, `StudentQuizMath`, `QuizResults`, `LecturerQuizResultsView`, `Backlog`, `WorkspaceApi` | Chạy bằng `node --test`, không dùng jsdom |

**Khác biệt so với tài liệu Sprint 3** (frontend đi theo backend FLTS):

- **Điểm đạt:** field là `passing_score`, không phải `passing_percentage`.
- **Câu hỏi:** không có `difficulty` hay `order_index` riêng từng câu; dùng `question_index`/`option_index`. Trích dẫn tên `citations`, không phải `citation_metadata`.
- **Không có endpoint unpublish:** chỉ có archive. Muốn sửa quiz đã xuất bản phải đi qua versions/restore; việc này chưa làm (BL-11).
- **Sửa quiz:** PATCH gửi lại toàn bộ nội dung, `options` là `string[4]` kèm `correct_index`. Không thêm/xóa câu hỏi, vì câu mới bắt buộc có citation mà UI không tạo được.
- **Lưu bản nháp:** không gửi `draft_version` hay `time_spent_seconds`, vì backend FLTS không có hai field này.

## b. Commit

Số test được đo tại các mốc trong các phiên làm việc. "—" nghĩa là commit được tạo trước các phiên này, không ghi lại số test.

| Hash | Task | Nội dung | Test sau commit |
|---|---|---|---|
| `8b847f4` | FAST-01 | Service API: learning objects, attempt, kết quả | — |
| `6c5de91` | FAST-01 | Chỉnh service theo backend FLTS | — |
| `0131f9d` | FAST-02 | Điều hướng sinh viên + khung Quiz Player | — |
| `b84166c` | FAST-02 | Session + trạng thái câu trả lời | — |
| `a9bc43e` | FAST-02 | Timeout tùy chọn cho autosave | — |
| `8cb0c68` | FAST-02 | Autosave + UI trạng thái lưu | — |
| `360f5b6` | FAST-02 | Đồng hồ, nộp bài, màn kết quả | 141 |
| `88f1156` | FAST-04B | Quiz Generator (preview, poll, retry) | 173 |
| `2fc3255` | FAST-05 | Quiz Editor + publish/archive + LaTeX an toàn | 200 |
| `a554fe8` | FAST-05C | LaTeX trong Student Quiz Player | 204 |
| `2afe266` | FAST-06 | Kết quả Quiz cho giảng viên | 219 |
| `79fb000` | FAST-07A | BL-01/02/03/05/06 | 228 |
| `7bbe5a4` | FAST-07A2 | Workspace dùng endpoint thật, bỏ thành công giả (BL-17) | 237 |

Mọi commit đều của Lê Thế Khánh Hưng, ngày 2026-10-30 và 2026-10-31.

## c. Mức độ kiểm chứng

| Tính năng | Unit/mock test | Tích hợp backend thật (service) | UI thủ công trên trình duyệt |
|---|---|---|---|
| Student Quiz Player | ✓ | ✓ FAST-03B: attempt 2, autosave, resume, submit, 25% | Một phần: chỉ màn Intro/History, read-only (FAST-03C) |
| Quiz Generator | ✓ | ✓ qua UI | ✓ FAST-04B: tạo quiz 3 câu, đúng 1 POST |
| Quiz Editor + publish/archive + LaTeX trong editor | ✓ | ✓ qua UI | ✓ FAST-05 |
| LaTeX trong Player | ✓ | — | **NOT TESTED** |
| Kết quả cho giảng viên | ✓ | ✓ qua UI | ✓ read-only (FAST-06: 2 lượt, 0% và 25%) |
| Sửa backlog FAST-07A | ✓ | — | **NOT TESTED** (chờ người dùng xác nhận) |
| Workspace thật FAST-07A2 (xử lý tài liệu, RAG, xóa) | ✓ | — | **NOT TESTED** |

Mọi kiểm chứng "backend thật" ở trên đều chạy trên **backend tham chiếu FLTS**, chưa chạy trên backend của nhóm.

## d. NOT TESTED khi chạy thật (kịch bản FAST-07B bị hoãn)

- Hiển thị autosave trên UI (chip trạng thái, "Lưu ngay")
- Đồng hồ đếm ngược
- Modal nộp bài
- Màn kết quả có citations và LaTeX
- Hết giờ tự nộp
- Quiz không giới hạn thời gian
- Mở nhiều tab cùng một bài làm
- RAG Workbench với Gemini thật
- Xử lý tài liệu thật (worker `documents`)
- Timeout khi tạo quiz (tắt `generation-worker`)

## e. Backlog

**DONE**

| Mã | Nội dung | Commit |
|---|---|---|
| BL-01 | Nút DEV Mode chỉ hiện khi `VITE_SHOW_DEV_LOGIN=true` | `79fb000` |
| BL-02 | Dashboard sinh viên: khóa học thật + nhãn "Dữ liệu minh họa" | `79fb000` |
| BL-03 | Thông báo phiên đăng nhập hết hạn sau 401 | `79fb000` |
| BL-05 | AppModal: sửa nơi gọi (`model-value` → `show`/`close` + footer) | `79fb000` |
| BL-06 | Bỏ fallback dữ liệu mẫu (chỉ giữ cho phiên DEV Mode) | `79fb000` |
| BL-10 | LaTeX trong Student Quiz Player | `a554fe8` |
| BL-17 | Bỏ thành công giả ở workspace (xử lý tài liệu, RAG, xóa) | `7bbe5a4` |

**OPEN — Frontend**

| Mã | Nội dung | Mức |
|---|---|---|
| BL-04 | Màn Intro chưa liệt kê từng lượt làm | Thấp |
| BL-07 | Lỗi 422 theo field hiển thị tiếng Anh của Laravel | Thấp |
| BL-11 | Sửa quiz đã xuất bản qua versions/restore | Trung bình |
| BL-12 | `npm audit`: esbuild, source-map-js | Thấp |
| BL-13 | Chunk KaTeX tải cả khi quiz không có công thức | Thấp |
| BL-14 | Chuỗi kiểu `$a$` bị hiểu là công thức | Thấp |
| BL-19 | Poll xử lý tài liệu không tự chạy lại sau khi reload trang | Thấp |

**OPEN — Backend/AI (chuyển nhóm)**

| Mã | Nội dung | Mức |
|---|---|---|
| BL-08 | Không chặn 2 lần tạo quiz chạy song song trong cùng course | Thấp |
| BL-09 | Xem trước nguồn đánh giá chủ đề lạc đề là "đủ nguồn"; ảnh hưởng câu hỏi nghiên cứu về hallucination | **CAO** |
| BL-15 | Kết quả quiz không phân trang | Thấp |
| BL-16 | Thiếu thống kê tỉ lệ đúng theo câu; cần cho Engagement Rubric | Trung bình |
| BL-18 | Cho phép xóa tài liệu đã dùng để tạo quiz | Trung bình |

## f. Ghi chú môi trường

- **Vite trên `/mnt/e` (WSL2) không nhận thay đổi file.** Cần chạy:
  `CHOKIDAR_USEPOLLING=true npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`
  Kiểm tra Vite đã phục vụ code mới bằng `curl -s http://127.0.0.1:5173/src/<file> | grep <chuỗi>`.
- **`VITE_SHOW_DEV_LOGIN`:** mẫu ở `frontend/.env.example`, mặc định `false`.
- **Token chỉ có hiệu lực cho một phiên:** đăng nhập ở chỗ khác sẽ làm phiên hiện tại nhận 401 (trang login sẽ hiện thông báo của BL-03).
- **Hai worker cần chạy:** `generation-worker` nghe queue `generation` (timeout 180 giây) để tạo quiz; `queue-worker` nghe `documents,default` để xử lý tài liệu.

## g. Đánh giá hợp nhất

### Trạng thái nhánh

- `git rev-parse --abbrev-ref @{upstream}` → `no upstream configured`.
- `git status -sb` → `## feature/sprint3-hung-quiz-frontend` (sạch trước khi tạo file này).
- merge-base với `origin/main` là `7b05844`, cũng chính là `origin/main` sau `git fetch`. Main **không có commit mới**, nên không có thay đổi nào trong `frontend/`.
- `git merge-tree --write-tree origin/main HEAD` → tree `a374ef7`, exit 0: **không xung đột**. Các file Sprint 1–2 đã sửa đều hợp nhất sạch: `api.js`, `LoginView.vue`, `StudentDashboardView.vue`, `CourseWorkspaceView.vue`, `courseDocuments.js`.

### Nhánh Sprint 3 của nhóm trên remote

- `origin/feature/sprint3-khoa-quiz-backend` (`ac2f32f`, Khoa, 2026-10-28): **chỉ có schema, model và `GenerateQuizJob`**; không có controller hay route.
- `origin/feature/sprint3-vuong-quiz-attempts` (`73bf4b3`, Vương, 2026-10-27): attempt, chấm điểm, kết quả cho giảng viên; kèm `docs/VUONG_SPRINT3_API_CONTRACT.md`.
- Chưa có nhánh `nguyen-quiz-prompt-engine`.

### Đối chiếu contract

So sánh contract mà frontend đang dùng với `origin/main` và hai nhánh trên. Mức ảnh hưởng là mức tác động lên frontend.

| Endpoint frontend dùng | Có trong backend nhóm? | Khác biệt | Ảnh hưởng FE |
|---|---|---|---|
| `POST /auth/login`, `/auth/me`, `/auth/logout` | ✓ main | Main có thêm alias `password-recovery` | Không |
| `GET /courses`, `/courses/{id}` | ✓ main | — | Không |
| `GET/POST/DELETE …/documents` | ✓ main | — | Không |
| `POST …/processing-runs` (`/retry`), `GET …/processing` | ✓ main | Main còn alias cũ `/process`, `/retry`, `/rag/query`; FE không dùng | Không |
| `POST …/evidence-prototypes` | ✓ main | Chưa đối chiếu sâu shape response | Thấp |
| `GET …/learning-objects` (list/show) | **✗** | Không có route hay controller | **Chặn**: danh sách quiz, editor, Player Intro |
| `POST …/learning-objects/quizzes` | **✗** | Khoa có `GenerateQuizJob` + bảng `generation_runs` (cùng `request_id`), chưa có controller | **Chặn**: Generator |
| `POST …/source-preview`, `…/generation-runs/retry` | **✗** | — | **Chặn**: Generator |
| `PATCH …/learning-objects/{id}` | **✗** | Schema Khoa: `quizzes.passing_percentage`, câu hỏi có `order_index`, `difficulty`, `citation_metadata`; version dùng `payload`/`prompt`, không có `content_payload`/`change_type`/`published_version_id` | **Chặn**: Editor |
| `POST …/publish`, `…/archive` | **✗** | — | **Chặn** |
| `POST …/quiz-attempts` (start) | ✓ Vương | Quiz trả `passing_percentage`, `order_index`; `draft_answers` nằm ở cấp gốc thay vì `attempt.draft_answers`; attempt có `draft_version`, `max_score`, `passed` | **Cao** |
| `PATCH …/quiz-attempts/{id}`, `…/submit` | ✓ Vương | **Bắt buộc `draft_version`** (FE không gửi, nên sẽ nhận 422); version cũ trả 409; có `time_spent_seconds` | **Cao**: autosave và nộp bài sẽ hỏng |
| `GET …/quiz-attempts` (history) | ✓ Vương | Phân trang 20 (`attempts` là đối tượng paginator); chỉ có `best_score`, không có `latest_score` | **Cao**: màn Intro/History |
| `GET …/quiz-results` | ✓ Vương | `attempts` phân trang thay vì `students[]` gộp theo sinh viên; không trả email; có `score_distribution` với các khoảng 0–50/50–70/70–90/90–100; `quiz` thiếu `passing_score`, `total_questions` | **Cao**: màn kết quả cho giảng viên |
| `GET …/quiz-results/attempts/{id}` | ✓ Vương | Payload `result` + `student`, dùng `citation_metadata`, `order_index` | **Cao**: panel chi tiết bài làm |

**Kết luận đối chiếu:**
- Backend của nhóm **chưa đủ** để chạy các luồng giảng viên (Generator, Editor, Publish).
- Phần bài làm và kết quả có, nhưng contract khác backend FLTS mà frontend đang dùng.
- **Đây là rủi ro tích hợp lớn nhất của Sprint 3.**

### Khuyến nghị trước khi merge

1. **Họp thống nhất contract (Hưng, Khoa, Vương).** Chọn một trong hai:
   - (A) backend nhóm theo contract FLTS (`passing_score`, `question_index`, `citations`, `published_version_id`, `content_payload`); hoặc
   - (B) frontend chuyển sang contract Notion/Vương (`passing_percentage`, `order_index`, `citation_metadata`, `draft_version`, phân trang).

   Phương án B ước tính phải sửa `learningObjects.js`, `quizSession.js` (gửi `draft_version`, xử lý 409), cùng `quizResultsModel.js` và `quizEditorModel.js`.
2. **Khoa bổ sung `LearningObjectController`** (list/show/storeQuiz/update/publish/archive/retry) và `source-preview`, đúng contract đã chốt.
3. **Chạy lại kiểm thử tích hợp và FAST-07B** trên backend nhóm, sau đó mới chuyển PR từ Draft sang Ready.

## h. Lệnh push/PR đề xuất (CHỈ LIỆT KÊ, CHƯA CHẠY)

```bash
cd /mnt/e/NCKH/FLTS_Team/FLTS_Project-sprint3
git push -u origin feature/sprint3-hung-quiz-frontend
gh pr create --draft --base main --head feature/sprint3-hung-quiz-frontend \
  --title "Sprint 3: Quiz frontend (player, generator, editor, results) — draft, chờ thống nhất contract backend" \
  --body-file docs/sprint3/hung-quiz-frontend-acceptance.md
```

Trước khi push, nếu muốn đưa file báo cáo này vào PR thì cần commit file (sau khi được duyệt).
