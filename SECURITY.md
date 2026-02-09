# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| 0.1.x   | :x:                |

## Security Best Practices

### Environment Variables

**Never commit sensitive data to the repository.** All sensitive configuration should use environment variables:

- `INFERENCE_API_KEY` — Inference service authentication key
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_DEV_AGENT_BOT_TOKEN` — Telegram bot tokens
- Supabase credentials (if using prod storage)
- Any secrets passed to agent containers via `env_vars`

### Configuration Files

- `.env` files are automatically ignored by `.gitignore`
- Use `.env.example` as a template — never commit actual `.env` files
- Rotate credentials regularly in production

### Inference Service Security

- **API Key Authentication**: Set `INFERENCE_API_KEY` to require auth on all `/v1/*` inference endpoints. Agents and the execution engine pass this key automatically.
- **Bind Address**: In production, bind the inference service to `127.0.0.1` (localhost only) and use a reverse proxy (nginx) with SSL for external access. Never expose port 7780 directly to the internet without auth.
- **CORS**: The inference service has CORS configured via `INFERENCE_CORS_ORIGINS`. Only allow trusted origins.

### Docker Agent Security

- Agents run in isolated Docker containers with limited resources (memory, CPU).
- **Protected Environment Keys**: Certain environment variables (`INFERENCE_API_KEY`, etc.) are automatically passed to agent containers but are not exposed in API responses.
- **Non-root user**: Agent containers run as a non-root `obelisk` user.
- **No network egress by default**: Consider using Docker network policies to restrict agent container network access if needed.
- **Resource limits**: Always set `--memory` and `--cpus` limits when deploying agents.

### Wallet Authentication

- Agent ownership is verified via wallet address (Privy). Only the connected wallet that deployed an agent can stop or restart it.
- Wallet addresses are stored as lowercase `user_id` labels on Docker containers.
- No private keys are ever stored or transmitted — Privy handles all wallet interactions client-side.

### UI Security

- `NEXT_PUBLIC_PRIVY_APP_ID` is a public key and is safe to include in client-side code.
- No secrets should be prefixed with `NEXT_PUBLIC_` — only public configuration.
- The UI communicates with the inference service and deployment service over authenticated HTTP.

### Production Deployment

- Use **HTTPS** for all endpoints (inference service, deployment service, UI)
- Use a **reverse proxy** (nginx) with SSL certificates (Let's Encrypt)
- Set `INFERENCE_API_KEY` to a strong, unique value
- Enable **firewall rules** to restrict access to service ports
- Use **PM2** or **systemd** for process management with auto-restart
- Monitor logs for suspicious activity
- Keep dependencies up to date

## Reporting a Vulnerability

If you discover a security vulnerability, please:

1. **Do not** open a public issue
2. Email security concerns to the maintainers
3. Include details about the vulnerability
4. Allow time for the issue to be addressed before public disclosure

We take security seriously and will respond promptly to all security reports.

## Security Checklist

Before deploying to production:

- [ ] `INFERENCE_API_KEY` is set to a strong value
- [ ] Inference service bound to `127.0.0.1` (behind reverse proxy)
- [ ] HTTPS enabled on all public endpoints
- [ ] All `.env` files are in `.gitignore`
- [ ] No hardcoded secrets in code
- [ ] Docker agent resource limits configured
- [ ] Firewall rules restrict port access
- [ ] PM2 or systemd managing services
- [ ] Log monitoring configured
- [ ] Dependencies are up to date
