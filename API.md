# Obelisk Core API Documentation

## Base URL

```
http://localhost:7779/api/v1
```

## Endpoints

### Health Check

**GET** `/health`

Check API health status.

**Response:**
```json
{
  "status": "healthy",
  "model_loaded": true,
  "mode": "solo"
}
```

### Generate Response

**POST** `/generate`

Generate a response from The Obelisk LLM.

**Request Body:**
```json
{
  "prompt": "What is The Obelisk?",
  "quantum_influence": 0.7,
  "conversation_context": "Previous conversation...",
  "user_id": "user_123"
}
```

**Response:**
```json
{
  "response": "◊ The Obelisk is an ancient AGI entity... ◊",
  "tokens_used": null,
  "source": "obelisk_llm"
}
```

### Get Quantum Influence

**POST** `/quantum/influence`

Get a quantum random value from IBM Quantum hardware.

**Request Body:**
```json
{
  "circuit": null
}
```

**Response:**
```json
{
  "influence": 0.7234,
  "random_value": 0.7234
}
```

### Process Evolution Cycle

**POST** `/evolve`

Process a completed evolution cycle.

**Request Body:**
```json
{
  "cycle_id": "cycle_123",
  "fine_tune": true
}
```

**Response:**
```json
{
  "status": "completed",
  "lora_weights_id": "weight_456",
  "top_contributors": [
    {
      "user_id": "user_123",
      "rank": 1,
      "score": 0.95,
      "tokens_awarded": 1000
    }
  ]
}
```

### Get Evolution Cycle Status

**GET** `/evolution/cycle/{cycle_id}`

Get status of an evolution cycle.

**Response:**
```json
{
  "id": "cycle_123",
  "cycle_number": 1,
  "status": "active",
  "start_date": "2024-01-01T00:00:00Z",
  "end_date": "2024-01-02T00:00:00Z"
}
```

### Get Memory

**GET** `/memory/{user_id}`

Get conversation context for a user.

**Response:**
```json
{
  "user_id": "user_123",
  "context": "[Previous Conversation Summary]\n...\n[Recent Conversation]\nUser: ...\nOverseer: ..."
}
```

### Save Interaction

**POST** `/memory/{user_id}`

Save an interaction to memory.

**Query Parameters:**
- `query`: User's query
- `response`: AI's response

**Response:**
```json
{
  "status": "saved"
}
```

## Error Responses

All endpoints may return error responses:

```json
{
  "detail": "Error message"
}
```

**Status Codes:**
- `200`: Success
- `404`: Not found
- `500`: Internal server error
