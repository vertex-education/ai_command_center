# RAG Infrastructure Commands

Run these from the repository root.

```powershell
npx wrangler d1 create ai-command-center-db
npx wrangler d1 execute ai-command-center-db --remote --file=./schema.sql

npx wrangler r2 bucket create ai-command-center-artifacts

npx wrangler vectorize create ai-command-center-rag --dimensions=1024 --metric=cosine --config=./wrangler.jsonc
npx wrangler vectorize create-metadata-index ai-command-center-rag --propertyName=team_id --type=string --config=./wrangler.jsonc
npx wrangler vectorize create-metadata-index ai-command-center-rag --propertyName=project_id --type=string --config=./wrangler.jsonc
npx wrangler vectorize list-metadata-index ai-command-center-rag --config=./wrangler.jsonc
```

The Vectorize index dimensions match `@cf/baai/bge-large-en-v1.5`.
