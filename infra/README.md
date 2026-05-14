# Docker infra

Here we create an infrastructure to run our backuped application.

We will use Docker Compose to run 
- a supabase stack that will be used to hold the backuped data.
- an nginx container to serve the lovable react code.
- other containers to automate the backup/restore process.

## Supabase stack

### Install

```sh
cd lovable-supabase-backup/infra/supabase

# Copy the fake env vars
cp .env.example .env

# Pull the latest images
docker compose pull
```

### Configuring and securing Supabase#
