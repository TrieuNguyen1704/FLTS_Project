# Bàn giao Sprint 2 — Đặng Trung Vương (PB15–PB18)

## Phạm vi và nguồn đối chiếu

- Phân công: https://app.notion.com/p/Sprint-2-3fe054a7d04b80a6bb67d5c2d20eefc4
- Repo triển khai: `TrieuNguyen1704/FLTS_Project`.
- Nhánh: `feature/sprint2-vuong-ai-processing`, tạo từ `origin/main` tại `b9de3db`.
- Chỉ tham khảo `FLTS/ai-service/rag_pipeline.py` và tests tại `FLTS origin/main` commit `9fc2df0`. Không merge/copy toàn bộ repo FLTS.
- Không thay đổi Laravel, Vue, Docker Compose, `.env`, embedding, retrieval hoặc endpoint `/process` của thành viên khác. Không push/merge main.

## Đối chiếu yêu cầu

| Yêu cầu | Cách thực hiện |
| --- | --- |
| Bốn thư viện đúng phiên bản | `requirements.txt` trên nhánh nền đã có `pypdf==5.0.1`, `python-docx==1.1.2`, `chromadb==0.5.23`, `google-genai==2.28.0`; giữ nguyên. |
| PB15–16: PDF/DOCX/DOC | `rag_pipeline.py`: pypdf, python-docx, antiword CLI, timeout 30 giây. |
| PB17: làm sạch | Chuẩn hóa Unicode/khoảng trắng, bỏ ký tự điều khiển và ký tự replacement, thay email bằng `[redacted-email]`; giữ dấu tiếng Việt và ký hiệu toán. |
| PB18: chunking | Mặc định 500 từ/chunk, overlap 50 từ; MD5 UTF-8, chỉ số chunk, số từ, metadata trang và vị trí nguồn. |
| Tests | `tests/test_rag_pipeline.py`; dữ liệu tổng hợp, không có tài liệu cá nhân. |

## Giao diện tích hợp cho Nguyên/Khoa

```python
from rag_pipeline import iter_document_units, iter_chunks

# Ưu tiên cho job: đọc file đã spool xuống đĩa, lấy từng đơn vị nguồn/chunk.
for chunk in iter_chunks(iter_document_units('/tmp/lecture.pdf')):
    # Đưa vào batch nhỏ cho bước embedding/persist thuộc phần Nguyên.
    print(chunk['chunk_index'], chunk['page_numbers'])
```

Tương thích tên hàm phía FLTS: `extract_document(content, extension, max_pages=None)` trả `ExtractedDocument(text, page_count, metadata)` và `chunk_text(text, target_words=500, overlap_words=50)` trả danh sách chunk. Adapter bytes/list chỉ dành cho upload nhỏ, có giới hạn; không dùng để gom dataset lớn. Caller phải giữ giới hạn upload trước khi đọc bytes. Ưu tiên iterator cho worker.

Một chunk có các trường: `chunk_index`, `content`, `word_count`, `token_estimate`, `content_hash`, `hash_algorithm`, `page_number`, `page_numbers`, `source_locator`, `source_locators`. `page_number` là trang đầu tiên có nội dung trong chunk; `page_numbers` giữ đầy đủ các trang kể cả phần overlap. Các marker `[Page N]` không tính vào số từ hoặc hash. MD5 chỉ dùng nhận dạng nội dung, không dùng bảo mật. `token_estimate` chỉ là ước lượng, không thay tokenizer của provider.

PDF dùng trang vật lý (1-based), kể cả trang trống giữa tài liệu. DOCX không có số trang ổn định khi chưa render; DOC qua antiword cũng không đảm bảo trang vật lý. Hai định dạng này trả `page_number = null`, dùng paragraph/table/segment locator, không bịa trang. DOCX giữ thứ tự đoạn–bảng–đoạn. OCR, PPT và semantic chunking không thuộc phân công này.

Lỗi đọc file trả `PipelineError` có `code`, `stage='extracting'`, `status_code`; caller chuyển sang envelope lỗi chung của endpoint. Không để lộ nội dung file hay stderr antiword cho client. Không có endpoint mới ở nhánh này.

## Quyết định kỹ thuật

- Giới hạn file 10 MiB (phù hợp cấu hình nhóm `DOCUMENT_MAX_KB=10240`), văn bản trích xuất 2.000.000 ký tự, tổng DOCX giải nén 50 MiB. File vượt ngưỡng bị từ chối rõ ràng, không cắt lặng lẽ.
- Iterator chunk chỉ giữ tối đa một cửa sổ từ. pypdf/python-docx vẫn có chi phí bộ nhớ nội bộ; không tuyên bố xử lý file vô hạn. PDF lấy từng trang, DOCX đọc package sau kiểm tra kích thước giải nén.
- antiword không dùng shell; file tạm đóng trước khi CLI đọc để tương thích Windows; stdout spool xuống đĩa, dọn thư mục tạm kể cả khi lỗi/timeout.
- Theo phân công Sprint 2, thêm/chạy Chroma thuộc Khoa. Nhánh này không khởi chạy vector DB/model local và không sử dụng API key.
- Điểm khác mẫu FLTS cần thống nhất lúc tích hợp: mẫu dùng 220/30 và SHA-256; nhánh này cố ý dùng **500/50 và MD5** theo nhiệm vụ Notion. Không tự áp dụng các phép thay ký tự kiểu `È -> ∪` vì có thể làm sai văn bản hợp lệ.

## Kiểm thử và giới hạn nghiệm thu

```powershell
cd C:\Users\Dang Trung Vuong\FLTS_Project\ai-service
.\.venv\Scripts\python.exe -m pytest -q
```

Kết quả local: **35 tests passed** (34 parser/cleaner/chunker + 1 health), Python 3.12. Có một DeprecationWarning từ Starlette/AnyIO, không phải lỗi test. Cài môi trường test bằng `python -m pip install -r requirements-test.txt` trong `.venv`; dependencies production giữ tại `requirements.txt`.

Môi trường test nhẹ dùng Python 3.12, pypdf 5.0.1, python-docx 1.1.2, pytest 8.3.3, fastapi 0.115.0 và httpx 0.27.2 trong `.venv` được Git ignore. Không cài toàn bộ Chroma/LLM dependency chỉ để test parser. Dockerfile hiện có sẵn antiword; máy Windows hiện không có antiword trong PATH. Tests DOC dùng mock để xác minh lệnh, timeout, mã lỗi và cleanup; chưa thay thế nghiệm thu file DOC thật trên container của Khoa. Chưa nghiệm thu end-to-end queue → `/process` → embedding vì thuộc tích hợp các thành viên.

## AI usage

Codex hỗ trợ đối chiếu phân công, viết parser/cleaner/chunker, tests và tài liệu bàn giao. Không sửa bài giao việc Notion, không dùng khóa API của leader, không gửi tài liệu giảng dạy lên AI, không tuyên bố reviewer đã duyệt. Nhóm cần review code, chạy thử DOC thật và duyệt PR trước khi merge. Đây không phải kết quả thực nghiệm so sánh RAG hay đánh giá chất lượng học tập.
