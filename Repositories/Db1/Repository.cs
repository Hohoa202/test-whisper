using Microsoft.EntityFrameworkCore;
using System.Linq.Expressions;
using WebApplicationBase.Data;
using WebApplicationBase.Repositories.Db1.IRepository;

namespace WebApplicationBase.Repositories.Db1
{
    public class Repository<T> : IRepository<T> where T : class
    {
        private readonly AppDb1Context _db;
        internal DbSet<T> dbSet;

        public Repository(AppDb1Context db)
        {
            _db = db;
            this.dbSet = _db.Set<T>();
        }
        public void Add(T entity)
        {
            dbSet.Add(entity);
        }

        public void AddRange(IEnumerable<T> entity)
        {
            dbSet.AddRange(entity);
        }

        public void UpdateRange(IEnumerable<T> entity)
        {
            dbSet.UpdateRange(entity);
        }

        public void Remove(T entity)
        {
            dbSet.Remove(entity);
        }

        public void RemoveRange(IEnumerable<T> entity)
        {
            dbSet.RemoveRange(entity);
        }

        public IEnumerable<T> GetAll()
        {
            IQueryable<T> query = dbSet;
            return query.ToList();
        }

        public IEnumerable<T> GetAll(Expression<Func<T, bool>> filter)
        {
            IQueryable<T> query = dbSet;
            query = query.Where(filter);
            return query.ToList();
        }

        public T? GetFirstOrDefault(Expression<Func<T, bool>> filter)
        {
            IQueryable<T> query = dbSet;
            query = query.Where(filter);
            return query.FirstOrDefault();
        }

        public int GetMax(Func<T, int> column)
        {
            IQueryable<T> query = dbSet;
            return query.Select(column).DefaultIfEmpty(0).Max();
        }

        public void Update(T entity)
        {
            dbSet.Update(entity);
        }
    }
}
