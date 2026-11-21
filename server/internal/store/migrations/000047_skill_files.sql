-- Skills imported from AgentBuddy or a repository can contain more than one
-- file. Keep every text file so the detail page can browse and edit the whole
-- Skill, while `content` remains the SKILL.md entry point used by Agent
-- instructions.
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS files jsonb NOT NULL DEFAULT '[]'::jsonb;
