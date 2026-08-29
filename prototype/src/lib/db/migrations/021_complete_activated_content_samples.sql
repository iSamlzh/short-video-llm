UPDATE platform_content_samples
SET workflow_status = 'completed',
    updated_at = COALESCE(
      (
        SELECT MAX(candidate.updated_at)
        FROM platform_structure_candidates candidate
        WHERE candidate.sample_id = platform_content_samples.id
          AND candidate.status = 'active'
      ),
      updated_at
    )
WHERE workflow_status != 'completed'
  AND EXISTS (
    SELECT 1
    FROM platform_structure_candidates candidate
    WHERE candidate.sample_id = platform_content_samples.id
      AND candidate.status = 'active'
  );
