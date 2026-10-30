// Fixture theo shape LecturerQuizResultController@index.
export const resultsFixture = {
  quiz: { learning_object_id: 7, title: 'Kiểm tra 15 phút', passing_score: 60, total_questions: 8, time_limit_minutes: 25 },
  summary: { enrolled_students: 3, participants: 2, total_attempts: 3, average_score: 53.33, highest_score: 100, pass_rate: 50 },
  students: [
    {
      student: { id: 2, name: 'Demo Student', email: 'student@flts.test' },
      attempts_count: 2,
      latest_score: 25,
      best_score: 25,
      last_submitted_at: '2026-10-30T07:10:00Z',
      attempts: [
        { id: 12, attempt_number: 2, score: 25, total_correct: 2, started_at: '2026-10-30T07:00:00Z', expires_at: null, submitted_at: '2026-10-30T07:10:00Z', auto_submitted: false, duration_seconds: 600 },
        { id: 11, attempt_number: 1, score: 25, total_correct: 2, started_at: '2026-10-29T07:00:00Z', expires_at: null, submitted_at: '2026-10-29T07:25:00Z', auto_submitted: true, duration_seconds: 1500 },
      ],
    },
    {
      student: { id: 5, name: 'Lê Thế Hưng', email: 'hung@flts.test' },
      attempts_count: 1,
      latest_score: 100,
      best_score: 100,
      last_submitted_at: '2026-10-28T07:10:00Z',
      attempts: [
        { id: 20, attempt_number: 1, score: 100, total_correct: 8, started_at: '2026-10-28T07:00:00Z', expires_at: null, submitted_at: '2026-10-28T07:10:00Z', auto_submitted: false, duration_seconds: 45 },
      ],
    },
  ],
}
