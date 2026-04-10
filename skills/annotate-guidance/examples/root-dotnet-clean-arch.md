# Project Overview

ASP.NET Core 8 Web API with Clean Architecture (CQRS + MediatR).

## Project map

- `src/Api/` - ASP.NET Core controllers, middleware, DI setup
- `src/Application/` - MediatR handlers, validators, DTOs
- `src/Domain/` - Entities, value objects, domain events
- `src/Infrastructure/` - EF Core, external services, file storage
- `tests/` - Unit and integration tests

## Commands

| Command | What it does |
|---|---|
| `dotnet build` | Build solution |
| `dotnet test` | Run all tests |
| `dotnet run --project src/Api` | Start API locally |
| `dotnet ef migrations add <Name> -p src/Infrastructure` | Create EF migration |
| `dotnet ef database update -p src/Infrastructure` | Apply migrations |

<important if="you are adding a new API endpoint">
- Add controller in `Api/Controllers/` inheriting `BaseApiController`
- Add command/query + handler + validator in `Application/Features/`
- See `Application/Features/Orders/Commands/CreateOrder/` for the pattern
</important>

<important if="you are adding or modifying EF Core migrations or database schema">
- Entities configured via `IEntityTypeConfiguration<T>` in `Infrastructure/Persistence/Configurations/`
- Always create a migration after schema changes — never modify existing migrations
</important>

<important if="you are writing or modifying tests">
- Unit tests: xUnit + NSubstitute, one test class per handler
- Integration tests: `WebApplicationFactory<Program>` with test database
- See `tests/Application.IntegrationTests/TestBase.cs` for setup
</important>
