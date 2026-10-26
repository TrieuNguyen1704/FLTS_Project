<?php

namespace App\Services;

use RuntimeException;

/** A browser-safe failure returned by the internal AI-service boundary. */
class RagServiceException extends RuntimeException
{
    public function __construct(string $message, int $code = 0, public readonly ?string $reason = null)
    {
        parent::__construct($message, $code);
    }

    public function generationRunCode(): string
    {
        return match ($this->reason) {
            'GEMINI_RATE_LIMITED' => 'RATE_LIMITED',
            'GEMINI_UNAVAILABLE' => 'SERVICE_BUSY',
            'NO_GROUNDED_CONTEXT' => 'NO_CONTEXT',
            'UNGROUNDABLE_CITATION' => 'GROUNDING_VALIDATION_FAILED',
            'LEARNING_OBJECT_QUALITY_INSUFFICIENT' => 'QUALITY_INSUFFICIENT',
            default => 'SERVICE_UNAVAILABLE',
        };
    }

    public function generationUserMessage(string $objectName): string
    {
        return match ($this->reason) {
            'GEMINI_RATE_LIMITED' => "Dịch vụ tạo {$objectName} đang bận. Vui lòng thử lại sau ít phút.",
            'GEMINI_UNAVAILABLE' => "Dịch vụ AI đang quá tải tạm thời khi tạo {$objectName}. Các phần đã hoàn tất được giữ lại; vui lòng thử lại sau ít phút.",
            'NO_GROUNDED_CONTEXT' => 'Không tìm thấy đủ nội dung phù hợp trong tài liệu đã chọn.',
            'UNGROUNDABLE_CITATION' => "AI chưa gắn được dẫn chứng hợp lệ cho {$objectName}. Kết quả không được lưu để tránh sai nguồn; vui lòng thử lại.",
            'LEARNING_OBJECT_QUALITY_INSUFFICIENT' => "Nội dung {$objectName} chưa đạt độ phủ yêu cầu và không được lưu. Hãy điều chỉnh phạm vi hoặc thử lại.",
            default => "Chưa thể tạo {$objectName} lúc này. Vui lòng thử lại sau.",
        };
    }
}
