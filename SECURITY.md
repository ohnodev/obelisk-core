# Security Policy

## Supported Versions

We provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Best Practices

### Environment Variables

**Never commit sensitive data to the repository.** All sensitive configuration should use environment variables:

- API keys (IBM Quantum, Mistral)
- Database credentials (Supabase)
- Service tokens

### Configuration Files

- `.env` files are automatically ignored by `.gitignore`
- Use `.env.example` as a template (never commit actual `.env` files)
- Rotate credentials regularly in production

### Code Security

- No hardcoded secrets in source code
- All API keys read from environment variables via `config.py`
- Storage credentials never logged or exposed

### Production Deployment

- Use HTTPS for all API endpoints
- Implement proper authentication/authorization
- Monitor logs for suspicious activity
- Keep dependencies up to date
- Use process managers (PM2, systemd) for production
- Set up proper firewall rules

## Reporting a Vulnerability

If you discover a security vulnerability, please:

1. **Do not** open a public issue
2. Email security concerns to the maintainers
3. Include details about the vulnerability
4. Allow time for the issue to be addressed before public disclosure

We take security seriously and will respond promptly to all security reports.

## Security Checklist

Before deploying to production:

- [ ] All `.env` files are in `.gitignore`
- [ ] No hardcoded secrets in code
- [ ] HTTPS enabled for API endpoints
- [ ] Authentication/authorization configured
- [ ] Logging configured (without sensitive data)
- [ ] Dependencies are up to date
- [ ] Database backups configured
- [ ] Monitoring/alerting set up
