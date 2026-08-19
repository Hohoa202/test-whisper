using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using System.Data;
using WebApplicationBase.Data;
using WebApplicationBase.Repositories.Db1.IRepository;

namespace WebApplicationBase.Repositories.Db1
{
    public class UnitOfWork : IUnitOfWork, IDisposable
    {
        private AppDb1Context _db;
        private readonly IHttpContextAccessor _httpCtAsor;

        public UnitOfWork(AppDb1Context db, IHttpContextAccessor httpCtAsor)
        {
            _db = db;
            _httpCtAsor = httpCtAsor;
            MstUser = new MstUserRepository(_db, _httpCtAsor);
        }

        public IMstUserRepository MstUser { get; private set; }

        public void UpdateEntry<T>(T entity)
        {
            if (entity != null)
            {
                _db.Entry(entity).State = EntityState.Modified;
            }
        }
        public void Save()
        {
            _db.SaveChanges();
        }

        public IDbContextTransaction BeginTransaction(IsolationLevel isolationLevel = IsolationLevel.ReadCommitted)
        {
            return _db.Database.BeginTransaction(isolationLevel);
        }

        public void Dispose()
        {
            if (_db != null)
            {
                _db.Dispose();
            }
        }
    }
}
