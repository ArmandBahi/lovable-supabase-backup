# Docker infra

Here we create an infrastructure to run our backuped application.

We will use Docker Compose to run 
- a supabase stack that will be used to hold the backuped data.
- an nginx container to serve the lovable react code.
- other containers to automate the backup/restore process.

## Supabase stack

This is an alternative to the official Supabase stack documentation: https://supabase.com/docs/guides/self-hosting/docker

### Install

```sh
cd lovable-supabase-backup/infra/supabase

# Copy the fake env vars
cp .env.example .env

# Pull the latest images
docker compose pull
```

### Configuring and securing Supabase

#### Quick setup

To generate secure passwords and secrets, run:

```sh
sh utils/generate-keys.sh
```

As the next step, use the following script to add the new API keys and asymmetric key pair:

```sh
sh utils/add-new-auth-keys.sh
```

#### Start the stack

```sh
docker compose -p supabase up -d
```

#### Stop the stack

```sh
docker compose -p supabase down
```