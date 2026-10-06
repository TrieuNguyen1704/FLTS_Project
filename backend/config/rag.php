<?php

return [
    'url' => env('AI_SERVICE_URL', 'http://ai:8001'),
    'token' => env('AI_SERVICE_TOKEN'),
    'embedding_model' => env('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-2'),
];
