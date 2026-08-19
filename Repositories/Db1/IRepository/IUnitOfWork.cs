using Microsoft.EntityFrameworkCore.Storage;
using System.Data;

namespace WebApplicationBase.Repositories.Db1.IRepository
{
    public interface IUnitOfWork
    {
        IMstUserRepository MstUser { get; }
        void UpdateEntry<T>(T entity);
        void Save();
        IDbContextTransaction BeginTransaction(IsolationLevel isolationLevel = IsolationLevel.ReadCommitted);
    }
}