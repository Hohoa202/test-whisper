using Microsoft.EntityFrameworkCore.Storage;
using System.Data;

namespace WebApplicationBase.Repositories.Db2.IRepository
{
    public interface IUnitOfWork
    {
        IMstEtcRepository MstEtc { get; }
        void UpdateEntry<T>(T entity);
        void Save();
        IDbContextTransaction BeginTransaction(IsolationLevel isolationLevel = IsolationLevel.ReadCommitted);
    }
}