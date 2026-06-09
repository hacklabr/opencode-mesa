# 09. Catálogo de Especialistas (Agency Integration)

## 8.1. Anti-Corruption Layer (ACL)

O catálogo `agency-agents` é um bounded context upstream. O plugin não consome seu schema diretamente; traduz através de uma ACL versionada.

```typescript
// src/agency/schema.ts (schema interno do domínio)
const SpecialistProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  roleType: z.enum(['analyst', 'creative', 'skeptic', 'executor']),
  systemPrompt: z.string().max(4000), // limitar para economizar contexto
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().optional(),
  toolsWhitelist: z.array(z.string()), // ex: ['file_write', 'code_grep']
  riskLevel: z.enum(['low', 'medium', 'high']),
  capabilities: z.array(z.string()),
  meta: z.object({
    sourceCatalogVersion: z.string(), // rastreabilidade
    importedAt: z.number(),
  }),
});

// src/agency/resolver.ts
class AgencyResolver {
  async resolve(participantIds: string[]): Promise<SpecialistProfile[]> {
    const rawCatalog = await this.loadRawCatalog(); // lê agency-agents
    return participantIds.map(id => {
      const raw = rawCatalog[id];
      if (!raw) throw new SpecialistNotFoundError(id);
      return this.acl.translate(raw); // valida e traduz para schema interno
    });
  }
}
```

## 8.2. Schema de Especialistas com Parâmetros de Modelo

```typescript
// Exemplo de perfil validado no domínio
const architectProfile: SpecialistProfile = {
  id: 'architect',
  name: 'Software Architect',
  roleType: 'analyst',
  systemPrompt: 'You are an expert software architect...',
  temperature: 0.2,              // baixa criatividade para decisões estruturais
  maxTokens: 2048,
  toolsWhitelist: ['file_read', 'code_grep', 'file_search'],
  riskLevel: 'medium',
  capabilities: ['ddd', 'event-storming', 'c4-modeling'],
  meta: { sourceCatalogVersion: 'agency-agents@v2.1', importedAt: 1700000000000 },
};
```

## 8.3. Devil's Advocate e Papel do Cético

Se `config.requireDissent === true` e o catálogo não contiver um especialista com `roleType: 'skeptic'`, o Workflow Engine designa dinamicamente um participante existente para assumir o papel de Devil's Advocate via **system prompt alternado** no turno de dissidência.
