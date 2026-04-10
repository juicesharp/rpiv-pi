# Application Layer (CQRS + MediatR)

## Responsibility
Command/query handlers orchestrating domain logic via MediatR pipeline. Sits between API controllers and Domain layer.

## Dependencies
- **MediatR**: Command/query dispatch
- **FluentValidation**: Request validation via pipeline behavior
- **AutoMapper**: Domain ↔ DTO mapping

## Consumers
- **API Controllers**: Send commands/queries via `IMediator`
- **Integration tests**: Direct handler invocation

## Module Structure
```
Application/
├── Common/
│   ├── Behaviors/          # MediatR pipeline (validation, logging)
│   └── Mappings/           # AutoMapper profiles
├── Features/               # One folder per aggregate
│   └── Orders/
│       ├── Commands/       # CreateOrder/, UpdateOrder/ (handler + validator + DTO)
│       └── Queries/        # GetOrder/, ListOrders/
└── DependencyInjection.cs  # Service registration
```

## Handler Pattern (Command with Validation)

```csharp
public record CreateOrderCommand(string CustomerId, List<LineItemDto> Items)
    : IRequest<Result<OrderDto>>;

public class CreateOrderValidator : AbstractValidator<CreateOrderCommand> {
    public CreateOrderValidator(IOrderRepository repo) {
        RuleFor(x => x.CustomerId).NotEmpty();
        RuleFor(x => x.Items).NotEmpty();
    }
}

public class CreateOrderHandler : IRequestHandler<CreateOrderCommand, Result<OrderDto>> {
    public async Task<Result<OrderDto>> Handle(
        CreateOrderCommand request, CancellationToken ct) {
        var order = Order.Create(request.CustomerId, request.Items); // Domain factory
        await _repo.AddAsync(order, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        return Result.Ok(_mapper.Map<OrderDto>(order));
    }
}
```

## Architectural Boundaries
- **NO domain logic in handlers**: Handlers orchestrate, domain objects contain logic
- **NO direct DbContext access**: Use repository abstractions
- **NO cross-feature references**: Features are independent vertical slices

<important if="you are adding a new feature or command/query handler">
## Adding a New Feature
1. Create folder under `Features/{Aggregate}/{Commands|Queries}/`
2. Add `Command`/`Query` record implementing `IRequest<Result<TDto>>`
3. Add `Validator` extending `AbstractValidator<TCommand>`
4. Add `Handler` implementing `IRequestHandler<TCommand, Result<TDto>>`
5. Add AutoMapper profile in `Common/Mappings/` if new DTO
</important>
