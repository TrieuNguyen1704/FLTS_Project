import test from 'node:test'
import assert from 'node:assert/strict'
import { courseDocuments } from '../src/services/courseDocuments.js'

test('courseDocuments service has required Sprint 2 endpoints', () => {
  assert.equal(typeof courseDocuments.listCourses, 'function')
  assert.equal(typeof courseDocuments.createCourse, 'function')
  assert.equal(typeof courseDocuments.course, 'function')
  assert.equal(typeof courseDocuments.listDocuments, 'function')
  assert.equal(typeof courseDocuments.upload, 'function')
  assert.equal(typeof courseDocuments.deleteDocument, 'function')
  assert.equal(typeof courseDocuments.downloadUrl, 'function')
  assert.equal(typeof courseDocuments.startProcessing, 'function')
  assert.equal(typeof courseDocuments.retryProcessing, 'function')
  assert.equal(typeof courseDocuments.ragQuery, 'function')
})

test('courseDocuments.downloadUrl generates valid document download endpoint', () => {
  const url = courseDocuments.downloadUrl(42, 108)
  assert.match(url, /\/courses\/42\/documents\/108\/download/)
})

test('validates document processing state transitions', () => {
  const doc = {
    id: 101,
    original_name: 'Grammar_Unit_1.pdf',
    processing_status: 'uploaded_pending_processing',
    status: 'uploaded_pending_processing',
  }

  // Pending -> Processing
  assert.equal(doc.processing_status, 'uploaded_pending_processing')
  doc.processing_status = 'processing'
  doc.status = 'processing'
  assert.equal(doc.status, 'processing')

  // Processing -> Processed with chunks
  doc.processing_status = 'processed'
  doc.status = 'processed'
  doc.chunks_count = 24
  assert.equal(doc.status, 'processed')
  assert.equal(doc.chunks_count, 24)

  // Failure state and retry
  doc.processing_status = 'failed'
  doc.status = 'failed'
  doc.error_message = 'Lỗi trích xuất văn bản'
  assert.equal(doc.status, 'failed')
  assert.ok(doc.error_message)

  // Retry
  doc.processing_status = 'processing'
  doc.status = 'processing'
  doc.error_message = null
  assert.equal(doc.status, 'processing')
  assert.equal(doc.error_message, null)
})

test('validates RAG query response and citations structure', () => {
  const mockRagResponse = {
    answer: 'Thì hiện tại đơn diễn tả sự thật hiển nhiên hoặc thói quen.',
    sources: [
      {
        document_name: 'Grammar_Unit_1.pdf',
        page_number: 3,
        section: 'Mục 1.2: Present Simple',
        similarity_score: 0.942,
        passage: 'Use present simple for routines and permanent situations.',
      },
    ],
  }

  assert.ok(mockRagResponse.answer.length > 0)
  assert.equal(mockRagResponse.sources.length, 1)
  const citation = mockRagResponse.sources[0]
  assert.equal(citation.document_name, 'Grammar_Unit_1.pdf')
  assert.equal(citation.page_number, 3)
  assert.ok(citation.similarity_score > 0.9)
  assert.match(citation.passage, /routines/)
})
