# Inference Service API

The Obelisk Inference Service is a FastAPI server that hosts the LLM model and serves inference requests over HTTP.

**Default URL**: `http://localhost:7780`

## Authentication

When `INFERENCE_API_KEY` is set in `.env`, all `/v1/*` endpoints require authentication. Send the key via either header:

```text
Authorization: Bearer <your-api-key>
X-API-Key: <your-api-key>
```

If `INFERENCE_API_KEY` is not set, authentication is disabled (local dev mode).

---

## Endpoints

### Root

**GET** `/`

Service info.

```json
{
  "service": "Obelisk Inference Service",
  "version": "0.2.0-beta",
  "model": "Qwen/Qwen3-0.6B",
  "status": "running"
}
```

---

### Health Check

**GET** `/health`

Detailed health status including model and queue state. No auth required.

**Response:**
```json
{
  "status": "healthy",
  "model_loaded": true,
  "model_name": "Qwen/Qwen3-0.6B",
  "device": "cuda",
  "memory_estimate_mb": 620,
  "queue_size": 0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"healthy"` or `"degraded"` |
| `model_loaded` | boolean | Whether the model is loaded and ready |
| `model_name` | string | Name of the loaded model |
| `device` | string | Device the model is running on (`cuda`, `cpu`) |
| `memory_estimate_mb` | integer | Estimated memory usage in MB |
| `queue_size` | integer | Number of pending requests in the queue |

---

### Queue Status

**GET** `/queue`

Check the inference queue. No auth required.

**Response:**
```json
{
  "pending_requests": 0,
  "is_processing": false
}
```

---

### Inference

**POST** `/v1/inference`

Generate a response from the LLM. **Requires auth** when `INFERENCE_API_KEY` is set.

Requests are queued and processed one at a time.

**Request Body:**

```json
{
  "query": "What is The Obelisk?",
  "system_prompt": "You are a helpful AI assistant.",
  "conversation_history": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi there! How can I help?" }
  ],
  "enable_thinking": true,
  "max_tokens": 1024,
  "temperature": 0.6,
  "top_p": 0.95,
  "top_k": 20,
  "repetition_penalty": 1.2
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `query` | string | **yes** | — | The user's input text |
| `system_prompt` | string | **yes** | — | System prompt for the model |
| `conversation_history` | array | no | `null` | Previous messages `[{role, content}]` |
| `enable_thinking` | boolean | no | `true` | Enable Qwen3 thinking/reasoning mode |
| `max_tokens` | integer | no | `1024` | Max output tokens (1–8192) |
| `temperature` | float | no | `0.6` | Sampling temperature (0.01–2.0) |
| `top_p` | float | no | `0.95` | Nucleus sampling threshold (0.01–1.0) |
| `top_k` | integer | no | `20` | Top-k sampling (1–200) |
| `repetition_penalty` | float | no | `1.2` | Repetition penalty (1.0–3.0) |

**Response:**

```json
{
  "response": "The Obelisk is an open-source AI agent framework...",
  "thinking_content": "<think>Let me explain what The Obelisk is...</think>",
  "model": "Qwen/Qwen3-0.6B",
  "input_tokens": 42,
  "output_tokens": 156,
  "generation_params": {
    "temperature": 0.6,
    "top_p": 0.95,
    "top_k": 20,
    "max_new_tokens": 1024
  },
  "source": "inference_service",
  "error": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `response` | string | Generated text (thinking content stripped) |
| `thinking_content` | string | Reasoning/thinking content (if thinking mode enabled) |
| `model` | string | Model used for generation |
| `input_tokens` | integer | Number of input tokens processed |
| `output_tokens` | integer | Number of output tokens generated |
| `generation_params` | object | Actual parameters used for generation |
| `source` | string | Always `"inference_service"` |
| `error` | string \| null | Error message if generation failed |

---

## Error Responses

| Status | Description |
|--------|-------------|
| `401` | Invalid or missing API key |
| `429` | Queue full — too many pending requests |
| `503` | Model not loaded (service starting or failed) |
| `504` | Request timed out |
| `500` | Unexpected inference error |

Error response format:
```json
{
  "detail": "Error message describing what went wrong"
}
```

---

## Examples

### curl

```bash
# Health check
curl http://localhost:7780/health

# Inference (no auth)
curl -X POST http://localhost:7780/v1/inference \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Hello, who are you?",
    "system_prompt": "You are a helpful assistant.",
    "max_tokens": 200
  }'

# Inference (with auth)
curl -X POST http://localhost:7780/v1/inference \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-key" \
  -d '{
    "query": "Explain quantum computing in one sentence.",
    "system_prompt": "You are a concise science explainer.",
    "enable_thinking": false,
    "max_tokens": 100,
    "temperature": 0.3
  }'
```

### Python

```python
import requests

response = requests.post(
    "http://localhost:7780/v1/inference",
    headers={"Authorization": "Bearer your-secret-key"},
    json={
        "query": "What is 2 + 2?",
        "system_prompt": "You are a math tutor.",
        "enable_thinking": True,
        "max_tokens": 200,
    },
)

data = response.json()
print(data["response"])
print(data["thinking_content"])  # View the model's reasoning
```

### TypeScript

```typescript
const res = await fetch("http://localhost:7780/v1/inference", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer your-secret-key",
  },
  body: JSON.stringify({
    query: "What is 2 + 2?",
    system_prompt: "You are a math tutor.",
    enable_thinking: true,
    max_tokens: 200,
  }),
});

const data = await res.json();
console.log(data.response);
```
